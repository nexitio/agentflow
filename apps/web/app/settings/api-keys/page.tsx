"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function ApiKeysSettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read"]);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/api-keys", { credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as { keys: ApiKey[] };
        setKeys(data.keys);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const createKey = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: newKeyName, scopes: newKeyScopes }),
      });
      if (res.ok) {
        const data = (await res.json()) as { key: string };
        setCreatedKey(data.key);
        setNewKeyName("");
        setShowCreate(false);
        void loadKeys();
      }
    } catch {
      setToast({ type: "error", message: "Failed to create API key." });
    } finally {
      setCreating(false);
    }
  }, [newKeyName, newKeyScopes, loadKeys]);

  const deleteKey = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/settings/api-keys/${id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (res.ok) {
          setToast({ type: "success", message: "API key deleted." });
          setDeleteConfirm(null);
          void loadKeys();
        }
      } catch {
        setToast({ type: "error", message: "Failed to delete." });
      }
    },
    [loadKeys],
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
          <h1 style={{ marginBottom: "4px" }}>API Keys</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Manage API keys for programmatic access to the AgentFlow API.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Create API Key"}
        </button>
      </div>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? "✓" : "✕"} {toast.message}</div>
        </div>
      )}

      {/* Created key display */}
      {createdKey !== null && (
        <div className="settings-section animate-fade-in-up">
          <div
            className="card"
            style={{ borderColor: "var(--ok-light)", background: "var(--ok-light)" }}
          >
            <div className="card-header" style={{ borderColor: "rgba(16, 185, 129, 0.2)" }}>
              <div>
                <div className="card-title" style={{ color: "var(--ok)" }}>
                  ✓ API Key Created
                </div>
                <div className="card-description">
                  Copy this key now — it won't be shown again.
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="flex items-center gap-2">
                <code
                  style={{
                    flex: 1,
                    background: "#fff",
                    border: "1px solid var(--border-light)",
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 14px",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {createdKey}
                </code>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdKey);
                    setToast({ type: "success", message: "Key copied to clipboard!" });
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="settings-section animate-fade-in-up">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Create New API Key</div>
            </div>
            <div className="card-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
                <div className="form-group">
                  <label className="form-label">Key Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. CI/CD Pipeline, Mobile App"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Scopes</label>
                  <div className="flex gap-2">
                    {["read", "write", "admin"].map((scope) => (
                      <label key={scope} className="toggle" style={{ cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={newKeyScopes.includes(scope)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewKeyScopes([...newKeyScopes, scope]);
                            } else {
                              setNewKeyScopes(newKeyScopes.filter((s) => s !== scope));
                            }
                          }}
                          style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                        />
                        <span
                          className="toggle-track"
                          style={{ width: "36px", height: "20px" }}
                        >
                          <span className="toggle-thumb" style={{ width: "16px", height: "16px" }} />
                        </span>
                        <span className="toggle-label" style={{ textTransform: "capitalize" }}>
                          {scope}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={createKey}
                  disabled={!newKeyName.trim() || creating}
                  style={{ alignSelf: "flex-start" }}
                >
                  {creating ? "Creating…" : "Generate Key"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing keys */}
      <div className="settings-section">
        <div className="settings-section-title">Active Keys ({keys.length})</div>

        {keys.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">🔑</div>
              <div className="empty-state-title">No API keys</div>
              <div className="empty-state-text">
                Create an API key to access the AgentFlow API programmatically.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {keys.map((key) => (
              <div key={key.id} className="card" style={{ padding: "14px 20px" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "var(--accent-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                      }}
                    >
                      🔑
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>{key.name}</span>
                        <code
                          style={{
                            fontSize: "11px",
                            background: "var(--bg)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontFamily: "monospace",
                          }}
                        >
                          {key.keyPrefix}…
                        </code>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                        Scopes: {key.scopes.join(", ")} · Created{" "}
                        {new Date(key.createdAt).toLocaleDateString()}
                        {key.lastUsedAt !== null &&
                          ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                        {key.expiresAt !== null &&
                          ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>

                  {deleteConfirm === key.id ? (
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "12px", color: "var(--err)" }}>Revoke?</span>
                      <button className="btn btn-danger btn-sm" onClick={() => void deleteKey(key.id)}>
                        Revoke
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--err)" }}
                      onClick={() => setDeleteConfirm(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
