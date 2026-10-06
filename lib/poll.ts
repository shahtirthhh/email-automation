import "server-only";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { db, toRun, type RunDoc, type WorkflowDoc } from "@/lib/db";
import { gmailCredentials } from "@/lib/env";
import { withInbox, type IncomingEmail } from "@/lib/mail/imap";
import { executeWorkflow, matchesTrigger } from "@/lib/workflow/executor";
import type { Run } from "@/lib/workflow/types";

const MAX_MESSAGES_PER_POLL = 25;
const TIME_BUDGET_MS = 45_000;

export type PollResult = {
  status: "baseline" | "idle" | "processed";
  newEmails: number;
  runs: number;
  failedRuns: number;
  remaining: number;
};

async function execute(
  workflow: WorkflowDoc,
  email: IncomingEmail,
  trigger: RunDoc["trigger"],
  dedupeKey?: string,
): Promise<RunDoc | null> {
  const { runs } = await db();
  const run: RunDoc = {
    _id: randomUUID(),
    workflowId: workflow._id,
    trigger,
    status: "running",
    email: { from: email.fields.from, subject: email.fields.subject, date: email.fields.date },
    steps: [],
    startedAt: new Date(),
    finishedAt: null,
    ...(dedupeKey ? { dedupeKey } : {}),
  };
  // Claim the email before doing anything with side effects. If an overlapping poll already
  // claimed it, the unique index rejects this insert and the email is not handled twice.
  try {
    await runs.insertOne(run);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return null;
    throw error;
  }
  const result = await executeWorkflow(workflow, email).catch((error: Error) => ({
    status: "failed" as const,
    steps: [],
    error,
  }));
  const update = { status: result.status, steps: result.steps, finishedAt: new Date() };
  await runs.updateOne({ _id: run._id }, { $set: update });
  return { ...run, ...update };
}

/**
 * Checks Gmail for mail that arrived since the last poll and runs every enabled workflow on it.
 *
 * The cursor always moves forward, including while every workflow is off, so switching a
 * workflow on never replays a backlog. Delivery is at-most-once: a step that fails is
 * recorded and not retried, because retrying could forward the same email twice.
 */
export async function pollInbox(): Promise<PollResult> {
  const startedAt = Date.now();
  const { workflows, mailboxState } = await db();
  const mailboxId = gmailCredentials().user.toLowerCase();

  return withInbox(async (inbox) => {
    const state = await mailboxState.findOne({ _id: mailboxId });
    const enabled = await workflows.find({ enabled: true }).toArray();
    const firstPoll = !state || state.uidValidity !== inbox.uidValidity;

    if (firstPoll || enabled.length === 0) {
      await mailboxState.updateOne(
        { _id: mailboxId },
        { $set: { uidValidity: inbox.uidValidity, lastUid: inbox.uidNext - 1, lastPolledAt: new Date() } },
        { upsert: true },
      );
      return { status: firstPoll ? "baseline" : "idle", newEmails: 0, runs: 0, failedRuns: 0, remaining: 0 };
    }

    const uids = await inbox.listNewUids(state.lastUid);
    const result: PollResult = { status: "processed", newEmails: 0, runs: 0, failedRuns: 0, remaining: uids.length };

    for (const uid of uids.slice(0, MAX_MESSAGES_PER_POLL)) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      const email = await inbox.fetch(uid);
      if (email && !email.automated) {
        result.newEmails += 1;
        for (const workflow of enabled) {
          const enabledAt = workflow.enabledAt?.getTime() ?? Infinity;
          if (email.receivedAt.getTime() < enabledAt || !matchesTrigger(workflow, email)) continue;
          const run = await execute(workflow, email, "auto", `${workflow._id}:${inbox.uidValidity}:${uid}`);
          if (!run) continue;
          result.runs += 1;
          if (run.status === "failed") result.failedRuns += 1;
        }
      }
      await mailboxState.updateOne({ _id: mailboxId }, { $max: { lastUid: uid } });
      result.remaining -= 1;
    }

    await mailboxState.updateOne({ _id: mailboxId }, { $set: { lastPolledAt: new Date() } });
    return result;
  });
}

/** Runs a workflow once against the newest email in the inbox, whether or not it is enabled. */
export async function testRun(workflow: WorkflowDoc): Promise<Run> {
  const email = await withInbox((inbox) => inbox.fetchLatest());
  if (!email) throw new Error("The inbox is empty, so there is no email to test with.");
  const run = await execute(workflow, email, "test");
  return toRun(run!);
}
