"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Agent {
  flowId: string;
  name: string;
  description: string;
  draftVersion: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  runCount: number;
}

export default function AgentsSettingsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/agents", { credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as { agents: Agent[] };
        setAgents(data.agents);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const createAgent = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "Untitled Agent" }),
      });
      if (res.ok) {
        setToast({ type: "success", message: "Agent created. Opening canvas…" });
        const data = (await res.json()) as { flow: { flowId: string } };
        window.location.href = `/flows/${data.flow.flowId}`;
        return;
      }
      setToast({ type: "error", message: "Failed to create agent." });
    } catch {
      setToast({ type: "error", message: "Connection failed." });
    } finally {
      setCreating(false);
    }
  }, []);

  const updateAgent = useCallback(
    async (flowId: string) => {
      try {
        const res = await fetch(`/api/settings/agents/${flowId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ name: editName }),
        });
        if (res.ok) {
          setToast({ type: "success", message: "Agent updated." });
          setEditingId(null);
          void loadAgents();
        }
      } catch {
        setToast({ type: "error", message: "Update failed." });
      }
    },
    [editName, loadAgents],
  );

  const deleteAgent = useCallback(
    async (flowId: string) => {
      try {
        const res = await fetch(`/api/settings/agents/${flowId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (res.ok) {
          setToast({ type: "success", message: "Agent deleted." });
          setDeleteConfirm(null);
          void loadAgents();
        }
      } catch {
        setToast({ type: "error", message: "Delete failed." });
      }
    },
    [loadAgents],
  );

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center justify-between" style={{ marginBottom: "32px" }}>
        <div>
          <h1 style={{ marginBottom: "4px" }}>Agents</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Manage your AI support agents and their configurations.
          </p>
        </div>
        <button className="btn btn-primary" onClick={createAgent} disabled={creating}>
          {creating ? (
            <span className="flex items-center gap-2">
              <span className="spinner" style={{ borderTopColor: "#fff" }} />
              Creating…
            </span>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Agent
            </>
          )}
        </button>
      </div>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>
            {toast.type === "success" ? "✓" : "✕"} {toast.message}
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🤖</div>
            <div className="empty-state-title">No agents yet</div>
            <div className="empty-state-text">
              Create your first AI agent to start supporting customers.
            </div>
            <button className="btn btn-primary" onClick={createAgent} disabled={creating}>
              Create Your First Agent
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {agents.map((agent) => (
            <div key={agent.flowId} className="card" style={{ padding: "16px 20px" }}>
              {editingId === agent.flowId ? (
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    className="form-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void updateAgent(agent.flowId);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{ flex: 1, maxWidth: "300px" }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => void updateAgent(agent.flowId)}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "10px",
                        background: "var(--accent-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px",
                        flexShrink: 0,
                      }}
                    >
                      🤖
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>{agent.name}</span>
                        {agent.publishedVersion !== null ? (
                          <span className="badge badge-ok">v{agent.publishedVersion}</span>
                        ) : (
                          <span className="badge badge-warn">draft</span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                        {agent.runCount} run{agent.runCount === 1 ? "" : "s"} · updated{" "}
                        {new Date(agent.updatedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/flows/${agent.flowId}`} className="btn btn-secondary btn-sm">
                      Edit Canvas
                    </Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditingId(agent.flowId);
                        setEditName(agent.name);
                      }}
                    >
                      Rename
                    </button>
                    {deleteConfirm === agent.flowId ? (
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: "12px", color: "var(--err)" }}>Delete?</span>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void deleteAgent(agent.flowId)}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: "var(--err)" }}
                        onClick={() => setDeleteConfirm(agent.flowId)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
