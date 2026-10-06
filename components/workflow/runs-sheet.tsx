"use client";

import { CircleCheck, CircleSlash, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NODE_META, type Run, type StepStatus } from "@/lib/workflow/types";

const STEP_ICONS: Record<StepStatus, React.ReactNode> = {
  success: <CircleCheck className="size-4 shrink-0 text-emerald-600" />,
  failed: <CircleX className="size-4 shrink-0 text-destructive" />,
  skipped: <CircleSlash className="size-4 shrink-0 text-muted-foreground" />,
};

export function RunsSheet({
  open,
  onOpenChange,
  runs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: Run[] | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Runs</SheetTitle>
          <SheetDescription>The 30 most recent runs of this workflow, newest first.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {runs === null && <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}
          {runs?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No runs yet. Use Test run, or switch the workflow on and wait for a new email.
            </p>
          )}
          {runs?.map((run) => (
            <div key={run.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>{run.status}</Badge>
                <Badge variant="outline">{run.trigger === "test" ? "test run" : "automatic"}</Badge>
                <time className="ml-auto text-xs text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-2 truncate text-sm font-medium">{run.email.subject}</p>
              <p className="truncate text-xs text-muted-foreground">From {run.email.from}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {run.steps.map((step) => (
                  <li key={step.nodeId} className="flex gap-2 text-xs">
                    {STEP_ICONS[step.status]}
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{NODE_META[step.type].label}.</span> {step.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
