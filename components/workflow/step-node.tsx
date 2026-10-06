"use client";

import { createContext, useContext } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Forward, Mail, MessageSquare, Sparkles, Webhook, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NODE_META, parseRecipients, type NodeType } from "@/lib/workflow/types";

/** Every node config is a flat record of strings, which keeps React Flow's typing simple. */
export type FlowNode = Node<Record<string, string>, NodeType>;

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  trigger: Mail,
  forward_email: Forward,
  send_in_slack: MessageSquare,
  api_call: Webhook,
  ai_extraction: Sparkles,
};

/** Ids of nodes with configuration problems, so the canvas can flag them. */
export const IssueContext = createContext<ReadonlySet<string>>(new Set());

function summary(type: NodeType, data: Record<string, string>): string {
  switch (type) {
    case "trigger": {
      const filters = [
        data.fromContains && `from has "${data.fromContains}"`,
        data.subjectContains && `subject has "${data.subjectContains}"`,
      ].filter(Boolean);
      return filters.length > 0 ? `Only when ${filters.join(" and ")}` : "Every new email";
    }
    case "forward_email": {
      const { valid } = parseRecipients(data.to);
      return valid.length > 0 ? `To ${valid.join(", ")}` : "No recipient yet";
    }
    case "send_in_slack":
      return data.channel || "No channel yet";
    case "api_call":
      return data.url || "No URL yet";
    case "ai_extraction":
      return data.instructions || "No instructions yet";
  }
}

export function StepNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const hasIssue = useContext(IssueContext).has(id);
  const meta = NODE_META[type];
  const Icon = NODE_ICONS[type];
  return (
    <div
      className={cn(
        "w-60 rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-shadow",
        selected && "ring-2 ring-ring",
        hasIssue && "border-destructive",
      )}
    >
      {type !== "trigger" && <Handle type="target" position={Position.Top} className="!size-2.5" />}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            type === "trigger" ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="truncate text-sm font-medium">{meta.label}</span>
        {meta.dummy && (
          <Badge variant="outline" className="ml-auto">
            dummy
          </Badge>
        )}
      </div>
      <p className={cn("mt-1.5 truncate text-xs text-muted-foreground", hasIssue && "text-destructive")}>
        {summary(type, data)}
      </p>
      <Handle type="source" position={Position.Bottom} className="!size-2.5" />
    </div>
  );
}
