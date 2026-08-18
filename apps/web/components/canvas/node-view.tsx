"use client";

import { getNodeDefinition, getNodeDefinitions } from "@agentflow/nodes/registry/definitions";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, useContext } from "react";

import { type CanvasNode, NodeActionsContext } from "./types";

const ICONS: Record<string, string> = {
  zap: "⚡",
  "git-branch": "🔀",
  terminal: ">_",
  bot: "🤖",
  cpu: "🧠",
  database: "🗄️",
  "book-open": "📖",
  wrench: "🔧",
};

/**
 * When a node has several handles on one side (e.g. a condition's true/false
 * branches) they stack on top of each other. Spread them vertically so each
 * branch is a distinct, targetable handle.
 */
function stackedHandleStyle(count: number, index: number): CSSProperties {
  if (count <= 1) return {};
  return { top: `${((index + 1) * 100) / (count + 1)}%` };
}

export function NodeView({ id, data, selected, type }: NodeProps<CanvasNode>) {
  const definition = getNodeDefinition(type);
  const actions = useContext(NodeActionsContext);
  if (definition === undefined) {
    return <div className="rf-node">unknown node</div>;
  }

  const subNodeDefs =
    definition.category === "agent"
      ? getNodeDefinitions().filter((candidate) => candidate.category === "sub-node")
      : [];

  return (
    <div
      className={`rf-node ${definition.category}${selected ? " selected" : ""}`}
      style={{
        width: 220,
        background: "var(--surface)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "10px",
        boxShadow: selected ? "0 0 0 2px var(--accent-soft), var(--shadow)" : "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: "14px" }}>{ICONS[definition.icon] ?? "•"}</span>
        <span style={{ fontWeight: 600, fontSize: "13px", flex: 1 }}>{definition.label}</span>
        {actions !== null && (
          <button
            type="button"
            title="Delete node"
            onClick={() => actions.removeNode(id)}
            style={{
              border: "none",
              background: "none",
              padding: "0 4px",
              fontSize: "14px",
              color: "var(--muted)",
            }}
          >
            ×
          </button>
        )}
      </div>

      {definition.handles.inputs.map((handle, index) => (
        <Handle
          key={handle}
          type="target"
          position={Position.Left}
          id={handle}
          style={stackedHandleStyle(definition.handles.inputs.length, index)}
        />
      ))}
      {definition.handles.outputs.map((handle, index) => (
        <Handle
          key={handle}
          type="source"
          position={Position.Right}
          id={handle}
          style={stackedHandleStyle(definition.handles.outputs.length, index)}
          title={handle === "true" || handle === "false" ? `when ${handle}` : undefined}
        />
      ))}

      {definition.category === "agent" && actions !== null && (
        <div style={{ padding: "8px 10px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: "4px",
            }}
          >
            SUB-NODES
          </div>
          {data.subNodeIds.length === 0 && (
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
              Add a model, memory, knowledge, or tool.
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
            {data.subNodeIds.map((subId) => {
              const subType = actions.nodeTypeById[subId];
              const subDef = subType !== undefined ? getNodeDefinition(subType) : undefined;
              return (
                <span key={subId} className="badge muted">
                  {ICONS[subDef?.icon ?? ""] ?? "•"} {subDef?.label ?? subType ?? subId}
                </span>
              );
            })}
          </div>
          <select
            aria-label="Add sub-node"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== "") {
                actions.addSubNode(id, event.target.value);
                event.target.value = "";
              }
            }}
            style={{ width: "100%", fontSize: "12px" }}
          >
            <option value="" disabled>
              ＋ Add sub-node…
            </option>
            {subNodeDefs.map((subDef) => (
              <option key={subDef.type} value={subDef.type}>
                {ICONS[subDef.icon] ?? "•"} {subDef.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
