"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { FlowDocument, FlowEdge, FlowNode } from "@agentflow/nodes/flow";
import { getNodeDefinition, getNodeDefinitions } from "@agentflow/nodes/registry/definitions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../../lib/api";
import { NodeView } from "./node-view";
import { Palette } from "./palette";
import { ParamForm } from "./param-form";
import { RunPanel } from "./run-panel";
import { type CanvasNode, NodeActionsContext } from "./types";

const nodeTypes = Object.fromEntries(
  getNodeDefinitions().map((definition) => [definition.type, NodeView]),
);

function toRfNodes(flow: FlowDocument): CanvasNode[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    // Defensive: legacy drafts may predate position defaults.
    position: node.position ?? { x: 0, y: 0 },
    data: { params: node.params, subNodeIds: node.subNodeIds ?? [] },
  }));
}

function toRfEdges(flow: FlowDocument): Edge[] {
  return flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  }));
}

const SAVE_STATE_LABEL: Record<string, string> = {
  clean: "saved",
  dirty: "unsaved changes",
  saving: "saving…",
  error: "save failed",
};

export function FlowEditor({
  flowId,
  initialName,
  initialFlow,
}: {
  flowId: string;
  initialName: string;
  initialFlow: unknown;
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() => toRfNodes(initialFlow as FlowDocument));
  const [edges, setEdges] = useState<Edge[]>(() => toRfEdges(initialFlow as FlowDocument));
  const [name, setName] = useState(initialName);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "error">("clean");
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const skipFirstSave = useRef(true);

  const nodeTypeById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of nodes) {
      map[node.id] = node.type;
    }
    return map;
  }, [nodes]);

  const serialize = useCallback((): FlowDocument => {
    const flowNodes: FlowNode[] = nodes.map((node) => {
      const definition = getNodeDefinition(node.type);
      return {
        id: node.id,
        type: node.type,
        typeVersion: definition?.typeVersion ?? 1,
        position: node.position,
        params: node.data.params,
        ...(node.data.subNodeIds.length > 0 ? { subNodeIds: node.data.subNodeIds } : {}),
      };
    });
    const flowEdges: FlowEdge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    }));
    return { version: 1, nodes: flowNodes, edges: flowEdges };
  }, [nodes, edges]);

  const doSave = useCallback(async () => {
    setSaveState("saving");
    try {
      await apiFetch(`/api/flows/${flowId}`, {
        method: "PUT",
        body: JSON.stringify({ name, flowJson: serialize() }),
      });
      setSaveState("clean");
    } catch {
      setSaveState("error");
    }
  }, [flowId, name, serialize]);

  // Autosave the draft, debounced, skipping the initial mount. `doSave`
  // already closes over name + serialized flow, so it is the only dependency.
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    setSaveState("dirty");
    const timer = setTimeout(() => {
      void doSave();
    }, 800);
    return () => clearTimeout(timer);
  }, [doSave]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) =>
      addEdge({ ...connection, id: `e-${crypto.randomUUID().slice(0, 8)}` }, current),
    );
  }, []);

  const addNode = useCallback(
    (type: string) => {
      const definition = getNodeDefinition(type);
      if (definition === undefined) {
        return;
      }
      const offset = (nodes.length % 8) * 36;
      const id = `n-${crypto.randomUUID().slice(0, 8)}`;
      const node: CanvasNode = {
        id,
        type,
        position: { x: 80 + offset, y: 80 + offset },
        data: { params: definition.paramDefaults() as Record<string, unknown>, subNodeIds: [] },
      };
      setNodes((current) => [...current, node]);
      setSelectedId(id);
    },
    [nodes.length],
  );

  const addSubNode = useCallback(
    (agentId: string, type: string) => {
      const definition = getNodeDefinition(type);
      const agent = nodes.find((candidate) => candidate.id === agentId);
      if (definition === undefined || agent === undefined) {
        return;
      }
      const id = `n-${crypto.randomUUID().slice(0, 8)}`;
      const subNode: CanvasNode = {
        id,
        type,
        position: {
          x: agent.position.x,
          y: agent.position.y + 230 + agent.data.subNodeIds.length * 110,
        },
        data: { params: definition.paramDefaults() as Record<string, unknown>, subNodeIds: [] },
      };
      setNodes((current) => [
        ...current.map((candidate) =>
          candidate.id === agentId
            ? {
                ...candidate,
                data: { ...candidate.data, subNodeIds: [...candidate.data.subNodeIds, id] },
              }
            : candidate,
        ),
        subNode,
      ]);
    },
    [nodes],
  );

  const removeNode = useCallback((id: string) => {
    setNodes((current) =>
      current
        .filter((candidate) => candidate.id !== id)
        .map((candidate) =>
          candidate.data.subNodeIds.includes(id)
            ? {
                ...candidate,
                data: {
                  ...candidate.data,
                  subNodeIds: candidate.data.subNodeIds.filter((subId) => subId !== id),
                },
              }
            : candidate,
        ),
    );
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const updateParams = useCallback((nodeId: string, params: Record<string, unknown>) => {
    setNodes((current) =>
      current.map((candidate) =>
        candidate.id === nodeId ? { ...candidate, data: { ...candidate.data, params } } : candidate,
      ),
    );
  }, []);

  const actions = useMemo(
    () => ({ addSubNode, removeNode, updateParams, nodeTypeById }),
    [addSubNode, removeNode, updateParams, nodeTypeById],
  );

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishMessage(null);
    try {
      // Ensure the latest draft is on the server before snapshotting it.
      await apiFetch(`/api/flows/${flowId}`, {
        method: "PUT",
        body: JSON.stringify({ name, flowJson: serialize() }),
      });
      await apiFetch(`/api/flows/${flowId}/publish`, { method: "POST" });
      setSaveState("clean");
      setPublishMessage("Published — runs now use this snapshot.");
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }, [flowId, name, serialize]);

  const selectedNode = nodes.find((candidate) => candidate.id === selectedId) ?? null;
  const selectedDefinition =
    selectedNode !== null ? getNodeDefinition(selectedNode.type) : undefined;

  return (
    <NodeActionsContext.Provider value={actions}>
      <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "10px 16px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <a href="/flows" style={{ fontSize: "14px" }}>
            ← Flows
          </a>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Flow name"
            style={{ fontWeight: 600, width: 240 }}
          />
          <span className="badge muted">{SAVE_STATE_LABEL[saveState]}</span>
          {publishMessage !== null && (
            <span className={`badge ${publishMessage.startsWith("Publish") ? "ok" : "err"}`}>
              {publishMessage}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void publish()}
            disabled={publishing}
            className="primary"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </header>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Palette onAdd={addNode} />
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} />
              <Controls />
            </ReactFlow>
          </div>
          <aside
            style={{
              width: 320,
              flexShrink: 0,
              overflowY: "auto",
              padding: "12px",
              display: "grid",
              gap: "0.75rem",
              alignContent: "start",
              background: "var(--surface)",
              borderLeft: "1px solid var(--border)",
            }}
          >
            {selectedNode !== null && selectedDefinition !== undefined ? (
              <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
                <div style={{ fontWeight: 700, fontSize: "13px" }}>
                  {selectedDefinition.label} — params
                </div>
                <ParamForm
                  definition={selectedDefinition}
                  values={selectedNode.data.params}
                  onChange={(key, value) =>
                    updateParams(selectedNode.id, { ...selectedNode.data.params, [key]: value })
                  }
                />
              </div>
            ) : (
              <div
                className="card"
                style={{ color: "var(--muted)", fontSize: "13px", textAlign: "center" }}
              >
                Select a node to edit its params.
              </div>
            )}
            <RunPanel flowId={flowId} />
          </aside>
        </div>
      </div>
    </NodeActionsContext.Provider>
  );
}
