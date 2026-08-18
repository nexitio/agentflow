"use client";

import { useCallback, useEffect, useState } from "react";

interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export default function WorkspaceSettingsPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings/workspace", { credentials: "same-origin" });
        if (res.ok) {
          const data = (await res.json()) as { workspace: Workspace };
          setWorkspace(data.workspace);
          setName(data.workspace.name);
        }
      } catch {
        // silent
      }
    }
    void load();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { workspace: Workspace };
        setWorkspace(data.workspace);
        setToast({ type: "success", message: "Workspace updated successfully." });
      } else {
        const data = (await res.json()) as { error?: { message: string } };
        setToast({ type: "error", message: data.error?.message ?? "Failed to update." });
      }
    } catch {
      setToast({ type: "error", message: "Connection failed." });
    } finally {
      setSaving(false);
    }
  }, [name]);

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>Workspace</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Configure your workspace name and general settings.
      </p>

      {toast !== null && (
        <div
          className="toast-container animate-slide-in-right"
          style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}
        >
          <div className={`toast toast-${toast.type}`}>
            {toast.type === "success" ? "✓" : "✕"} {toast.message}
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">General</div>
              <div className="card-description">Basic workspace information visible to your team</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>
              <div className="form-group">
                <label className="form-label" htmlFor="ws-name">
                  Workspace Name
                </label>
                <input
                  id="ws-name"
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Company"
                />
                <span className="form-hint">
                  This appears in the sidebar and email notifications
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="ws-desc">
                  Description
                </label>
                <textarea
                  id="ws-desc"
                  className="form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this workspace"
                  rows={3}
                />
                <span className="form-hint">Optional description for your team</span>
              </div>

              <div>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="spinner" style={{ borderTopColor: "#fff" }} />
                      Saving…
                    </span>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {workspace !== null && (
        <div className="settings-section">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Workspace Info</div>
                <div className="card-description">Read-only workspace metadata</div>
              </div>
            </div>
            <div className="card-body">
              <div style={{ display: "grid", gap: "12px", maxWidth: "480px" }}>
                {[
                  { label: "Workspace ID", value: workspace.id },
                  { label: "Created", value: new Date(workspace.createdAt).toLocaleString() },
                  { label: "Last Updated", value: new Date(workspace.updatedAt).toLocaleString() },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border-light)",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{item.label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, fontFamily: "monospace" }}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="card" style={{ borderColor: "var(--warn-light)" }}>
          <div className="card-header">
            <div>
              <div className="card-title" style={{ color: "var(--warn)" }}>Danger Zone</div>
              <div className="card-description">Irreversible actions</div>
            </div>
          </div>
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontSize: "14px", fontWeight: 500 }}>Delete Workspace</div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  Permanently delete this workspace and all its data
                </div>
              </div>
              <button className="btn btn-danger btn-sm" disabled>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
