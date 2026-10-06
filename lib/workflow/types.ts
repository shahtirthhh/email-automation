// Shared between server and client: keep this file free of server-only imports.

export const NODE_TYPES = [
  "trigger",
  "forward_email",
  "send_in_slack",
  "api_call",
  "ai_extraction",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export type NodeConfigs = {
  trigger: { fromContains: string; subjectContains: string };
  forward_email: { to: string; note: string };
  send_in_slack: { channel: string; message: string };
  api_call: { url: string; secret: string; body: string };
  ai_extraction: { instructions: string };
};

export type WorkflowNode<T extends NodeType = NodeType> = {
  [K in T]: {
    id: string;
    type: K;
    position: { x: number; y: number };
    data: NodeConfigs[K];
  };
}[T];

export type WorkflowEdge = { id: string; source: string; target: string };

export type Workflow = {
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
};

export type StepStatus = "success" | "failed" | "skipped";

export type RunStep = {
  nodeId: string;
  type: NodeType;
  status: StepStatus;
  detail: string;
  durationMs: number;
};

export type Run = {
  id: string;
  workflowId: string;
  trigger: "auto" | "test";
  status: "running" | "success" | "failed";
  email: { from: string; subject: string; date: string | null };
  steps: RunStep[];
  startedAt: string;
  finishedAt: string | null;
};

/** Sent to the client in place of a stored secret; sending it back keeps the stored value. */
export const SECRET_MASK = "••••••••";

export const TRIGGER_NODE_ID = "trigger";

export const DEFAULT_CONFIGS: { [K in NodeType]: NodeConfigs[K] } = {
  trigger: { fromContains: "", subjectContains: "" },
  forward_email: { to: "", note: "" },
  send_in_slack: { channel: "#general", message: "New email from {{email.from}}: {{email.subject}}" },
  api_call: {
    url: "",
    secret: "",
    body: '{\n  "from": "{{email.from}}",\n  "subject": "{{email.subject}}",\n  "text": "{{email.text}}"\n}',
  },
  ai_extraction: { instructions: "Extract the sender's intent and any order numbers." },
};

export const NODE_META: {
  [K in NodeType]: { label: string; description: string; dummy: boolean };
} = {
  trigger: { label: "New email", description: "Starts the flow when an email arrives", dummy: false },
  forward_email: { label: "Forward email", description: "Forward the email to other addresses", dummy: false },
  send_in_slack: { label: "Send in Slack", description: "Post a message to a channel", dummy: true },
  api_call: { label: "Call an API", description: "POST JSON to a URL with a secret", dummy: false },
  ai_extraction: { label: "AI extraction", description: "Extract structured fields", dummy: true },
};

export const TEMPLATE_VARIABLES = [
  "email.from",
  "email.fromName",
  "email.to",
  "email.subject",
  "email.text",
  "email.date",
  "email.messageId",
  "extracted.summary",
  "extracted.category",
] as const;

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function parseRecipients(value: string): { valid: string[]; invalid: string[] } {
  const parts = value
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    valid: parts.filter((part) => EMAIL_RE.test(part)),
    invalid: parts.filter((part) => !EMAIL_RE.test(part)),
  };
}

/** Nodes reachable from the trigger, in execution (breadth-first) order, trigger excluded. */
export function reachableNodes(workflow: Pick<Workflow, "nodes" | "edges">): WorkflowNode[] {
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>([TRIGGER_NODE_ID]);
  const queue = [TRIGGER_NODE_ID];
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of workflow.edges) {
      if (edge.source !== current || seen.has(edge.target)) continue;
      const node = byId.get(edge.target);
      if (!node) continue;
      seen.add(edge.target);
      ordered.push(node);
      queue.push(edge.target);
    }
  }
  return ordered;
}

export type Issue = { nodeId: string | null; message: string };

/** Problems that would stop a workflow from running correctly. Checked before enabling. */
export function validateWorkflow(workflow: Pick<Workflow, "nodes" | "edges">): Issue[] {
  const issues: Issue[] = [];
  const steps = reachableNodes(workflow);
  if (steps.length === 0) {
    issues.push({ nodeId: null, message: "Connect at least one step to the New email trigger." });
  }
  for (const node of steps) {
    if (node.type === "forward_email") {
      const { valid, invalid } = parseRecipients(node.data.to);
      if (invalid.length > 0) {
        issues.push({ nodeId: node.id, message: `Forward email: invalid address "${invalid[0]}".` });
      } else if (valid.length === 0) {
        issues.push({ nodeId: node.id, message: "Forward email: add at least one recipient." });
      }
    }
    if (node.type === "api_call") {
      let url: URL | null = null;
      try {
        url = new URL(node.data.url);
      } catch {}
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
        issues.push({ nodeId: node.id, message: "Call an API: enter a valid http(s) URL." });
      }
      try {
        JSON.parse(node.data.body);
      } catch {
        issues.push({
          nodeId: node.id,
          message: "Call an API: body is not valid JSON. Keep {{variables}} inside quoted strings.",
        });
      }
    }
  }
  return issues;
}
