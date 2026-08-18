"use client";

import { getNodeDefinitions } from "@agentflow/nodes/registry/definitions";
import type { NodeCategory } from "@agentflow/nodes/types";

const GROUPS: Array<{ label: string; category: NodeCategory | "sub-node" }> = [
  { label: "Triggers", category: "trigger" },
  { label: "Agents", category: "agent" },
  { label: "Sub-nodes", category: "sub-node" },
  { label: "Logic", category: "logic" },
  { label: "Actions", category: "action" },
];

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

export function Palette({ onAdd }: { onAdd(type: string): void }) {
  const definitions = getNodeDefinitions();
  return (
    <div className="card" style={{ width: 190, flexShrink: 0, overflowY: "auto", padding: "10px" }}>
      <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "8px" }}>Node palette</div>
      {GROUPS.map((group) => {
        const items = definitions.filter((d) => d.category === group.category);
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group.label} style={{ marginBottom: "10px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--muted)",
                margin: "4px 2px",
              }}
            >
              {group.label.toUpperCase()}
            </div>
            {items.map((definition) => (
              <button
                type="button"
                key={definition.type}
                onClick={() => onAdd(definition.type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: "4px",
                  fontSize: "13px",
                }}
                title={definition.description}
              >
                <span>{ICONS[definition.icon] ?? "•"}</span>
                <span>{definition.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
