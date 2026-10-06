import "server-only";
import { MongoClient, type Collection } from "mongodb";
import { mongoUri } from "@/lib/env";
import type { Run, Workflow } from "@/lib/workflow/types";

export type WorkflowDoc = Omit<Workflow, "id" | "createdAt" | "updatedAt"> & {
  _id: string;
  /** When the workflow was last switched on. Mail received before this is never processed. */
  enabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RunDoc = Omit<Run, "id" | "startedAt" | "finishedAt"> & {
  _id: string;
  /** Set for automatic runs only; the unique index makes each email run once per workflow. */
  dedupeKey?: string;
  startedAt: Date;
  finishedAt: Date | null;
};

export type MailboxStateDoc = {
  _id: string;
  uidValidity: string;
  lastUid: number;
  lastPolledAt: Date;
};

type Collections = {
  workflows: Collection<WorkflowDoc>;
  runs: Collection<RunDoc>;
  mailboxState: Collection<MailboxStateDoc>;
};

// Reuse the connection across hot reloads in dev and warm invocations on Vercel.
const globalForMongo = globalThis as unknown as { mongoCollections?: Promise<Collections> };

async function connect(): Promise<Collections> {
  const client = await new MongoClient(mongoUri()).connect();
  const db = client.db();
  const collections: Collections = {
    workflows: db.collection<WorkflowDoc>("workflows"),
    runs: db.collection<RunDoc>("runs"),
    mailboxState: db.collection<MailboxStateDoc>("mailbox_state"),
  };
  await Promise.all([
    collections.runs.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true }),
    collections.runs.createIndex({ workflowId: 1, startedAt: -1 }),
    collections.workflows.createIndex({ enabled: 1 }),
  ]);
  return collections;
}

export function db(): Promise<Collections> {
  if (!globalForMongo.mongoCollections) {
    globalForMongo.mongoCollections = connect().catch((error) => {
      globalForMongo.mongoCollections = undefined;
      throw error;
    });
  }
  return globalForMongo.mongoCollections;
}

export function toWorkflow(doc: WorkflowDoc): Workflow {
  return {
    id: doc._id,
    name: doc.name,
    enabled: doc.enabled,
    nodes: doc.nodes,
    edges: doc.edges,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toRun(doc: RunDoc): Run {
  return {
    id: doc._id,
    workflowId: doc.workflowId,
    trigger: doc.trigger,
    status: doc.status,
    email: doc.email,
    steps: doc.steps,
    startedAt: doc.startedAt.toISOString(),
    finishedAt: doc.finishedAt?.toISOString() ?? null,
  };
}
