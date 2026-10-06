"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createWorkflow, deleteWorkflow, pollNow, setWorkflowEnabled } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NODE_META, reachableNodes, type Workflow } from "@/lib/workflow/types";

export function NewWorkflowButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createWorkflow();
          if (result && !result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} New workflow
    </Button>
  );
}

export function PollButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await pollNow();
          if (!result.ok) return void toast.error("Could not check the inbox", { description: result.error });
          const { status, newEmails, runs, failedRuns, remaining } = result.data;
          if (status === "baseline") toast.success("Connected. Emails that arrive from now on will be picked up.");
          else if (status === "idle") toast.info("No workflow is on, so new emails were skipped.");
          else
            toast.success(`Checked ${newEmails} new email${newEmails === 1 ? "" : "s"}`, {
              description: `${runs} run${runs === 1 ? "" : "s"}, ${failedRuns} failed${remaining > 0 ? `, ${remaining} emails still queued` : ""}.`,
            });
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} /> Check inbox now
    </Button>
  );
}

export function WorkflowList({ workflows }: { workflows: Workflow[] }) {
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<Workflow | null>(null);

  if (workflows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No workflows yet. Create one to choose what happens when an email arrives.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {workflows.map((workflow) => {
        const steps = reachableNodes(workflow).map((node) => NODE_META[node.type].label);
        return (
          <li key={workflow.id} className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3">
            <Link href={`/workflows/${workflow.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{workflow.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {steps.length > 0 ? `New email, then ${steps.join(", ")}` : "No steps connected yet"}
              </p>
            </Link>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={workflow.enabled}
                disabled={pending}
                onCheckedChange={(next) =>
                  startTransition(async () => {
                    const result = await setWorkflowEnabled(workflow.id, next);
                    if (!result.ok) toast.error(result.error);
                    else if (result.data.issues.length > 0)
                      toast.error("This workflow can't be switched on yet", {
                        description: result.data.issues[0].message,
                      });
                  })
                }
              />
              {workflow.enabled ? "On" : "Off"}
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${workflow.name}`}
              onClick={() => setDeleting(workflow)}
            >
              <Trash2 />
            </Button>
          </li>
        );
      })}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The workflow and its run history are removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = deleting!.id;
                setDeleting(null);
                startTransition(async () => {
                  const result = await deleteWorkflow(id);
                  if (!result.ok) toast.error(result.error);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ul>
  );
}
