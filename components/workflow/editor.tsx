"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, History, LoaderCircle, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { getRuns, saveWorkflow, setWorkflowEnabled, testWorkflow, type WorkflowDraft } from "@/app/actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Inspector } from "@/components/workflow/inspector";
import { RunsSheet } from "@/components/workflow/runs-sheet";
import { IssueContext, NODE_ICONS, StepNode, type FlowNode } from "@/components/workflow/step-node";
import {
  DEFAULT_CONFIGS,
  NODE_META,
  NODE_TYPES,
  parseRecipients,
  reachableNodes,
  TRIGGER_NODE_ID,
  validateWorkflow,
  type NodeType,
  type Run,
  type Workflow,
  type WorkflowNode,
} from "@/lib/workflow/types";

const DRAG_TYPE = "application/x-workflow-node";
const STEP_TYPES: NodeType[] = NODE_TYPES.filter((type) => type !== "trigger");
const nodeTypes = Object.fromEntries(NODE_TYPES.map((type) => [type, StepNode]));

function toFlowNodes(nodes: WorkflowNode[]): FlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { ...node.data },
    deletable: node.type !== "trigger",
  }));
}

function toDraft(name: string, nodes: FlowNode[], edges: Edge[]): WorkflowDraft {
  return {
    name: name.trim() || "Untitled workflow",
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data }) as WorkflowNode),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

function Editor({ workflow }: { workflow: Workflow }) {
  const { screenToFlowPosition, getNodes, fitView } = useReactFlow<FlowNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(toFlowNodes(workflow.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(workflow.edges);
  const [name, setName] = useState(workflow.name);
  const [enabled, setEnabled] = useState(workflow.enabled);
  const [busy, setBusy] = useState<"save" | "toggle" | "test" | null>(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);

  const draft = useMemo(() => toDraft(name, nodes, edges), [name, nodes, edges]);
  const serialized = JSON.stringify(draft);
  const [savedSerialized, setSavedSerialized] = useState(serialized);
  const dirty = serialized !== savedSerialized;

  const issues = useMemo(() => validateWorkflow(draft), [draft]);
  const issueIds = useMemo(() => new Set(issues.flatMap((issue) => issue.nodeId ?? [])), [issues]);
  const selected = nodes.find((node) => node.selected);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const addNode = useCallback(
    (type: NodeType, position?: { x: number; y: number }) => {
      const id = `${type}_${crypto.randomUUID().slice(0, 8)}`;
      const current = getNodes();
      // Clicking a palette item chains the new step under the selected one (or the lowest one).
      const anchor =
        current.find((node) => node.selected) ??
        current.reduce((lowest, node) => (node.position.y > lowest.position.y ? node : lowest));
      setNodes([
        ...current.map((node) => ({ ...node, selected: false })),
        {
          id,
          type,
          position: position ?? { x: anchor.position.x, y: anchor.position.y + 130 },
          data: { ...DEFAULT_CONFIGS[type] },
          selected: true,
        },
      ]);
      if (!position) {
        setEdges((existing) => addEdge({ id: `${anchor.id}-${id}`, source: anchor.id, target: id }, existing));
        // Wait for the new node to be measured, then bring the whole flow back into view.
        setTimeout(() => fitView({ maxZoom: 1, padding: 0.4, duration: 200 }), 50);
      }
    },
    [getNodes, setNodes, setEdges, fitView],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge(connection, current)),
    [setEdges],
  );

  const updateNode = useCallback(
    (id: string, patch: Record<string, string>) =>
      setNodes((current) =>
        current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
      ),
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    },
    [setNodes, setEdges],
  );

  /** Saves the canvas. Returns false when the save failed or switched the workflow off. */
  async function save(): Promise<boolean> {
    const result = await saveWorkflow(workflow.id, draft);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setSavedSerialized(serialized);
    if (result.data.turnedOff) {
      setEnabled(false);
      toast.warning("Saved, and switched the workflow off because it has problems.", {
        description: result.data.issues[0]?.message,
      });
      return false;
    }
    return true;
  }

  async function handleSave() {
    setBusy("save");
    if (await save()) toast.success("Saved");
    setBusy(null);
  }

  async function handleToggle(next: boolean) {
    setBusy("toggle");
    if (next && issues.length > 0) {
      toast.error("Fix this before switching the workflow on", { description: issues[0].message });
    } else if (!dirty || (await save())) {
      const result = await setWorkflowEnabled(workflow.id, next);
      if (!result.ok) toast.error(result.error);
      else if (result.data.issues.length > 0) toast.error(result.data.issues[0].message);
      else {
        setEnabled(result.data.enabled);
        toast.success(
          result.data.enabled
            ? "Workflow is on. It runs on emails that arrive from now on."
            : "Workflow is off. No emails will be processed.",
        );
      }
    }
    setBusy(null);
  }

  async function openRuns() {
    setRunsOpen(true);
    setRuns(null);
    const result = await getRuns(workflow.id);
    if (result.ok) setRuns(result.data);
    else toast.error(result.error);
  }

  async function handleTest() {
    setConfirmTest(false);
    setBusy("test");
    if (!dirty || (await save())) {
      const result = await testWorkflow(workflow.id);
      if (!result.ok) toast.error("Test run failed", { description: result.error });
      else {
        if (result.data.status === "failed") toast.error("Test run finished with a failed step");
        else toast.success("Test run finished");
        await openRuns();
      }
    }
    setBusy(null);
  }

  const forwardTargets = reachableNodes(draft).flatMap((node) =>
    node.type === "forward_email" ? parseRecipients(node.data.to).valid : [],
  );
  const apiTargets = reachableNodes(draft).flatMap((node) => (node.type === "api_call" ? [node.data.url] : []));

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/" />} aria-label="Back to workflows">
          <ArrowLeft />
        </Button>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Workflow name"
          className="max-w-xs font-medium"
        />
        {dirty && <Badge variant="outline">Unsaved changes</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <label className="mr-2 flex items-center gap-2 text-sm">
            <Switch checked={enabled} disabled={busy !== null} onCheckedChange={handleToggle} />
            {enabled ? "On" : "Off"}
          </label>
          <Button variant="outline" onClick={openRuns}>
            <History /> Runs
          </Button>
          <Button variant="outline" disabled={busy !== null || issues.length > 0} onClick={() => setConfirmTest(true)}>
            {busy === "test" ? <LoaderCircle className="animate-spin" /> : <Play />} Test run
          </Button>
          <Button disabled={busy !== null || !dirty} onClick={handleSave}>
            {busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />} Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col gap-2 border-r p-3">
          <p className="text-xs font-medium text-muted-foreground">Steps. Click or drag onto the canvas.</p>
          {STEP_TYPES.map((type) => {
            const Icon = NODE_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, type)}
                onClick={() => addNode(type)}
                className="flex cursor-grab items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{NODE_META[type].label}</span>
                {NODE_META[type].dummy && <span className="ml-auto text-[10px] text-muted-foreground">dummy</span>}
              </button>
            );
          })}
        </aside>

        <main
          className="min-w-0 flex-1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const type = event.dataTransfer.getData(DRAG_TYPE) as NodeType;
            if (!STEP_TYPES.includes(type)) return;
            event.preventDefault();
            addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
        >
          <IssueContext value={issueIds}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={(connection) =>
                connection.target !== TRIGGER_NODE_ID && connection.source !== connection.target
              }
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 0.4 }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </IssueContext>
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l">
          <Inspector
            node={selected}
            issues={issues.filter((issue) => issue.nodeId === selected?.id)}
            onChange={updateNode}
            onDelete={deleteNode}
          />
          {!selected && issues.length > 0 && (
            <ul className="flex flex-col gap-1 px-4 text-xs text-destructive">
              {issues.map((issue) => (
                <li key={`${issue.nodeId}${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <AlertDialog open={confirmTest} onOpenChange={setConfirmTest}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run this workflow for real?</AlertDialogTitle>
            <AlertDialogDescription>
              A test run takes the newest email in your inbox and performs every step once, ignoring the trigger
              filters.{" "}
              {forwardTargets.length > 0 && `That email will be forwarded to ${forwardTargets.join(", ")}. `}
              {apiTargets.length > 0 && `A request will be sent to ${apiTargets.join(", ")}. `}
              {dirty && "Your unsaved changes are saved first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTest}>Run once</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RunsSheet open={runsOpen} onOpenChange={setRunsOpen} runs={runs} />
    </div>
  );
}

export function WorkflowEditor({ workflow }: { workflow: Workflow }) {
  return (
    <ReactFlowProvider>
      <Editor workflow={workflow} />
    </ReactFlowProvider>
  );
}
