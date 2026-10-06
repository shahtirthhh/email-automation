import { getWorkflows } from "@/app/actions";
import { NewWorkflowButton, PollButton, WorkflowList } from "@/components/workflow-list";
import { missingEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const missing = missingEnv();
  // APP_PASSWORD is optional in development, where the app runs without a login.
  const blocking = missing.filter((name) => name !== "APP_PASSWORD" && name !== "CRON_SECRET");
  const result = blocking.includes("MONGODB_URI") ? null : await getWorkflows();
  const activeCount = result?.ok ? result.data.filter((workflow) => workflow.enabled).length : 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Email automation</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount === 0
              ? "Every workflow is off. Incoming email is left alone."
              : `${activeCount} workflow${activeCount === 1 ? " is" : "s are"} on and will run on new email.`}
          </p>
        </div>
        <PollButton />
        <NewWorkflowButton />
      </header>

      {missing.length > 0 && (
        <div className="rounded-xl border border-dashed p-4 text-sm">
          <p className="font-medium">Missing environment variables</p>
          <p className="mt-1 text-muted-foreground">
            Copy <code>.env.example</code> to <code>.env.local</code> and set: {missing.join(", ")}.
            {blocking.length === 0 && " Local development works without these, but Vercel needs them."}
          </p>
        </div>
      )}

      {result?.ok && <WorkflowList workflows={result.data} />}
      {result && !result.ok && (
        <p className="rounded-xl border border-destructive p-4 text-sm text-destructive">
          Could not load workflows: {result.error}
        </p>
      )}
    </main>
  );
}
