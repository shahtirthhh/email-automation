"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NODE_META, TEMPLATE_VARIABLES, type Issue } from "@/lib/workflow/types";
import type { FlowNode } from "@/components/workflow/step-node";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm leading-none font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Variables() {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">Variables you can use in the text above:</p>
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_VARIABLES.map((name) => (
          <code key={name} className="rounded bg-muted px-1 py-0.5 text-[11px]">{`{{${name}}}`}</code>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        The extracted values exist only after an AI extraction step earlier in the flow.
      </p>
    </div>
  );
}

export function Inspector({
  node,
  issues,
  onChange,
  onDelete,
}: {
  node: FlowNode | undefined;
  issues: Issue[];
  onChange: (id: string, patch: Record<string, string>) => void;
  onDelete: (id: string) => void;
}) {
  if (!node || !node.type) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Select a step to configure it. Drag from the dot under a step to the dot on top of another to connect them.
      </p>
    );
  }

  const { id, type, data } = node;
  const meta = NODE_META[type];
  const bind = (key: string) => ({
    value: data[key] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(id, { [key]: event.target.value }),
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-medium">{meta.label}</h2>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      {meta.dummy && (
        <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
          This step is a placeholder. It records what it would do in the run log and does nothing else.
        </p>
      )}

      {type === "trigger" && (
        <>
          <Field label="Sender contains" hint="Optional. Matches the sender's name or address.">
            <Input placeholder="billing@acme.com" {...bind("fromContains")} />
          </Field>
          <Field label="Subject contains" hint="Optional. Leave both empty to run on every new email.">
            <Input placeholder="Invoice" {...bind("subjectContains")} />
          </Field>
        </>
      )}

      {type === "forward_email" && (
        <>
          <Field label="Forward to" hint="Separate several addresses with commas.">
            <Input placeholder="teammate@example.com" {...bind("to")} />
          </Field>
          <Field label="Note" hint="Optional. Added above the forwarded email.">
            <Textarea rows={3} {...bind("note")} />
          </Field>
        </>
      )}

      {type === "send_in_slack" && (
        <>
          <Field label="Channel">
            <Input placeholder="#general" {...bind("channel")} />
          </Field>
          <Field label="Message">
            <Textarea rows={3} {...bind("message")} />
          </Field>
          <Variables />
        </>
      )}

      {type === "api_call" && (
        <>
          <Field label="URL" hint="Receives a POST request.">
            <Input placeholder="https://api.example.com/hooks/email" {...bind("url")} />
          </Field>
          <Field label="Secret" hint="Optional. Sent as the header Authorization: Bearer <secret>.">
            <Input type="password" autoComplete="off" {...bind("secret")} />
          </Field>
          <Field label="JSON body">
            <Textarea rows={8} className="font-mono text-xs" spellCheck={false} {...bind("body")} />
          </Field>
          <Variables />
        </>
      )}

      {type === "ai_extraction" && (
        <Field label="Instructions">
          <Textarea rows={4} {...bind("instructions")} />
        </Field>
      )}

      {issues.map((issue) => (
        <p key={issue.message} className="text-xs text-destructive">
          {issue.message}
        </p>
      ))}

      {type !== "trigger" && (
        <Button variant="destructive" size="sm" className="self-start" onClick={() => onDelete(id)}>
          <Trash2 /> Remove step
        </Button>
      )}
    </div>
  );
}
