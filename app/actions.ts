"use server";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, toRun, toWorkflow, type WorkflowDoc } from "@/lib/db";
import { pollInbox, testRun, type PollResult } from "@/lib/poll";
import { appPassword, isValidSession, SESSION_COOKIE, sessionToken } from "@/lib/session";
import {
  DEFAULT_CONFIGS,
  SECRET_MASK,
  TRIGGER_NODE_ID,
  validateWorkflow,
  type Issue,
  type Run,
  type Workflow,
  type WorkflowNode,
} from "@/lib/workflow/types";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Server Actions are public endpoints, so each one checks the session itself. */
async function authed<T>(fn: () => Promise<T>): Promise<Result<T>> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(session))) return { ok: false, error: "Not signed in." };
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    console.error(error);
    return { ok: false, error: (error as Error).message };
  }
}

const text = (max: number) => z.string().max(max);
const base = { id: z.string().min(1).max(64), position: z.object({ x: z.number(), y: z.number() }) };

const nodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("trigger"), data: z.object({ fromContains: text(200), subjectContains: text(200) }) }),
  z.object({ ...base, type: z.literal("forward_email"), data: z.object({ to: text(1000), note: text(2000) }) }),
  z.object({ ...base, type: z.literal("send_in_slack"), data: z.object({ channel: text(100), message: text(2000) }) }),
  z.object({ ...base, type: z.literal("api_call"), data: z.object({ url: text(2000), secret: text(500), body: text(20000) }) }),
  z.object({ ...base, type: z.literal("ai_extraction"), data: z.object({ instructions: text(2000) }) }),
]);

const draftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  nodes: z.array(nodeSchema).max(50),
  edges: z.array(z.object({ id: z.string().max(200), source: z.string(), target: z.string() })).max(200),
});

export type WorkflowDraft = Pick<Workflow, "name" | "nodes" | "edges">;

function maskSecrets(workflow: Workflow): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.type === "api_call" && node.data.secret
        ? { ...node, data: { ...node.data, secret: SECRET_MASK } }
        : node,
    ),
  };
}

async function findWorkflow(id: string): Promise<WorkflowDoc> {
  const { workflows } = await db();
  const doc = await workflows.findOne({ _id: id });
  if (!doc) throw new Error("Workflow not found.");
  return doc;
}

export async function getWorkflows(): Promise<Result<Workflow[]>> {
  return authed(async () => {
    const { workflows } = await db();
    const docs = await workflows.find().sort({ createdAt: -1 }).toArray();
    return docs.map((doc) => maskSecrets(toWorkflow(doc)));
  });
}

export async function getWorkflow(id: string): Promise<Result<Workflow>> {
  return authed(async () => maskSecrets(toWorkflow(await findWorkflow(id))));
}

export async function createWorkflow() {
  const result = await authed(async () => {
    const { workflows } = await db();
    const now = new Date();
    const id = randomUUID();
    await workflows.insertOne({
      _id: id,
      name: "Untitled workflow",
      enabled: false,
      enabledAt: null,
      nodes: [{ id: TRIGGER_NODE_ID, type: "trigger", position: { x: 0, y: 0 }, data: DEFAULT_CONFIGS.trigger }],
      edges: [],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  if (!result.ok) return result;
  redirect(`/workflows/${result.data}`);
}

export async function saveWorkflow(
  id: string,
  draft: WorkflowDraft,
): Promise<Result<{ workflow: Workflow; issues: Issue[]; turnedOff: boolean }>> {
  return authed(async () => {
    const parsed = draftSchema.safeParse(draft);
    if (!parsed.success) throw new Error("The workflow could not be saved because it is malformed.");
    const existing = await findWorkflow(id);

    const storedSecrets = new Map(
      existing.nodes.flatMap((node) => (node.type === "api_call" ? [[node.id, node.data.secret] as const] : [])),
    );
    const nodes: WorkflowNode[] = parsed.data.nodes.map((node) =>
      node.type === "api_call" && node.data.secret === SECRET_MASK
        ? { ...node, data: { ...node.data, secret: storedSecrets.get(node.id) ?? "" } }
        : node,
    );
    if (nodes.filter((node) => node.type === "trigger").length !== 1 || !nodes.some((node) => node.id === TRIGGER_NODE_ID && node.type === "trigger")) {
      throw new Error("A workflow needs exactly one New email trigger.");
    }
    const ids = new Set(nodes.map((node) => node.id));
    if (ids.size !== nodes.length) throw new Error("Two steps share the same id.");
    const edges = parsed.data.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target) && edge.target !== TRIGGER_NODE_ID && edge.source !== edge.target,
    );

    // Never leave a workflow running with a configuration that cannot work.
    const issues = validateWorkflow({ nodes, edges });
    const turnedOff = existing.enabled && issues.length > 0;

    const { workflows } = await db();
    const updated = await workflows.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          name: parsed.data.name,
          nodes,
          edges,
          updatedAt: new Date(),
          ...(turnedOff ? { enabled: false, enabledAt: null } : {}),
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) throw new Error("Workflow not found.");
    revalidatePath("/");
    return { workflow: maskSecrets(toWorkflow(updated)), issues, turnedOff };
  });
}

export async function setWorkflowEnabled(
  id: string,
  enabled: boolean,
): Promise<Result<{ enabled: boolean; issues: Issue[] }>> {
  return authed(async () => {
    const { workflows } = await db();
    if (enabled) {
      const issues = validateWorkflow(await findWorkflow(id));
      if (issues.length > 0) return { enabled: false, issues };
    }
    await workflows.updateOne(
      { _id: id },
      { $set: { enabled, enabledAt: enabled ? new Date() : null, updatedAt: new Date() } },
    );
    revalidatePath("/");
    return { enabled, issues: [] };
  });
}

export async function deleteWorkflow(id: string): Promise<Result<null>> {
  return authed(async () => {
    const { workflows, runs } = await db();
    await workflows.deleteOne({ _id: id });
    await runs.deleteMany({ workflowId: id });
    revalidatePath("/");
    return null;
  });
}

export async function getRuns(workflowId: string): Promise<Result<Run[]>> {
  return authed(async () => {
    const { runs } = await db();
    const docs = await runs.find({ workflowId }).sort({ startedAt: -1 }).limit(30).toArray();
    return docs.map(toRun);
  });
}

export async function testWorkflow(id: string): Promise<Result<Run>> {
  return authed(async () => testRun(await findWorkflow(id)));
}

export async function pollNow(): Promise<Result<PollResult>> {
  return authed(async () => {
    const result = await pollInbox();
    revalidatePath("/");
    return result;
  });
}

export async function login(_previous: string | null, formData: FormData): Promise<string | null> {
  const password = appPassword();
  if (!password) redirect("/");
  const expected = Buffer.from(password);
  const received = Buffer.from(String(formData.get("password") ?? ""));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return "Wrong password.";
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}
