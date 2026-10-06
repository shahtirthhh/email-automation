import { notFound } from "next/navigation";
import { getWorkflow } from "@/app/actions";
import { WorkflowEditor } from "@/components/workflow/editor";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({ params }: PageProps<"/workflows/[id]">) {
  const { id } = await params;
  const result = await getWorkflow(id);
  if (!result.ok) notFound();
  return <WorkflowEditor workflow={result.data} />;
}
