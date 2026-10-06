import "server-only";
import type { IncomingEmail } from "@/lib/mail/imap";
import { forwardEmail } from "@/lib/mail/smtp";
import { renderJsonTemplate, renderTemplate, type TemplateContext } from "@/lib/workflow/template";
import {
  parseRecipients,
  reachableNodes,
  TRIGGER_NODE_ID,
  type NodeType,
  type RunStep,
  type Workflow,
  type WorkflowNode,
} from "@/lib/workflow/types";

const API_TIMEOUT_MS = 15_000;

type ExecutionContext = { email: IncomingEmail; template: TemplateContext };

type Handlers = {
  [K in Exclude<NodeType, "trigger">]: (
    config: WorkflowNode<K>["data"],
    context: ExecutionContext,
  ) => Promise<string>;
};

/** Each handler returns a one-line result for the run log, or throws to fail the step. */
const handlers: Handlers = {
  async forward_email(config, { email }) {
    const { valid, invalid } = parseRecipients(config.to);
    if (invalid.length > 0) throw new Error(`Invalid recipient "${invalid[0]}"`);
    if (valid.length === 0) throw new Error("No recipients configured");
    const result = await forwardEmail(email, valid, config.note);
    if (result.rejected.length > 0) {
      throw new Error(`Rejected by Gmail for: ${result.rejected.join(", ")}`);
    }
    return `Forwarded to ${result.accepted.join(", ")}`;
  },

  async api_call(config, { template }) {
    let body: unknown;
    try {
      body = renderJsonTemplate(JSON.parse(config.body), template);
    } catch {
      throw new Error("Body is not valid JSON");
    }
    let response: Response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      throw new Error(`Request failed: ${cause ?? (error as Error).message}`);
    }
    const text = (await response.text().catch(() => "")).slice(0, 300);
    if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
    return `POST ${config.url} returned ${response.status}`;
  },

  async send_in_slack(config, { template }) {
    const message = renderTemplate(config.message, template);
    return `Dummy step, nothing sent. Would post to ${config.channel || "(no channel)"}: ${message.slice(0, 200)}`;
  },

  async ai_extraction(_config, { email, template }) {
    template.extracted = {
      summary: email.fields.text.replace(/\s+/g, " ").trim().slice(0, 140),
      category: "general",
    };
    return "Dummy step, no model called. Set extracted.summary and extracted.category to placeholder values.";
  },
};

async function runNode(node: WorkflowNode, context: ExecutionContext): Promise<string> {
  switch (node.type) {
    case "forward_email":
      return handlers.forward_email(node.data, context);
    case "api_call":
      return handlers.api_call(node.data, context);
    case "send_in_slack":
      return handlers.send_in_slack(node.data, context);
    case "ai_extraction":
      return handlers.ai_extraction(node.data, context);
    case "trigger":
      return "";
  }
}

export function matchesTrigger(workflow: Pick<Workflow, "nodes">, email: IncomingEmail): boolean {
  const trigger = workflow.nodes.find((node) => node.type === "trigger");
  if (!trigger || trigger.type !== "trigger") return false;
  const contains = (haystack: string, needle: string) =>
    !needle.trim() || haystack.toLowerCase().includes(needle.trim().toLowerCase());
  return (
    contains(`${email.fields.fromName} ${email.fields.from}`, trigger.data.fromContains) &&
    contains(email.fields.subject, trigger.data.subjectContains)
  );
}

/**
 * Walks the graph breadth-first from the trigger. A node runs once, as soon as any
 * parent succeeds; nodes only reachable through failed steps are reported as skipped.
 */
export async function executeWorkflow(
  workflow: Pick<Workflow, "nodes" | "edges">,
  email: IncomingEmail,
): Promise<{ status: "success" | "failed"; steps: RunStep[] }> {
  const context: ExecutionContext = { email, template: { email: email.fields, extracted: {} } };
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const steps: RunStep[] = [];
  const done = new Set<string>([TRIGGER_NODE_ID]);
  const queue = [TRIGGER_NODE_ID];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of workflow.edges) {
      const node = byId.get(edge.target);
      if (edge.source !== current || !node || done.has(node.id)) continue;
      done.add(node.id);
      const startedAt = Date.now();
      try {
        const detail = await runNode(node, context);
        steps.push({ nodeId: node.id, type: node.type, status: "success", detail, durationMs: Date.now() - startedAt });
        queue.push(node.id);
      } catch (error) {
        steps.push({
          nodeId: node.id,
          type: node.type,
          status: "failed",
          detail: (error as Error).message,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  for (const node of reachableNodes(workflow)) {
    if (done.has(node.id)) continue;
    steps.push({ nodeId: node.id, type: node.type, status: "skipped", detail: "An earlier step failed", durationMs: 0 });
  }

  return { status: steps.some((step) => step.status === "failed") ? "failed" : "success", steps };
}
