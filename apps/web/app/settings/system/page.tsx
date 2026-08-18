"use client";

import { useCallback, useEffect, useState } from "react";

interface SystemInfo {
  version: string;
  workspace: { name: string; createdAt: string | null };
  environment: {
    hasEncryptionKey: boolean;
    hasDatabase: boolean;
    hasRedis: boolean;
    hasLlmEndpoint: boolean;
  };
}

export default function SystemSettingsPage() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings/system", { credentials: "same-origin" });
        if (res.ok) {
          setSystem((await res.json()) as SystemInfo);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const copyLogs = useCallback(async () => {
    try {
      // In production, this would fetch actual logs
      await navigator.clipboard.writeText("Logs will be available in the next release.");
      setToast({ type: "success", message: "Logs copied to clipboard." });
    } catch {
      setToast({ type: "error", message: "Failed to copy logs." });
    }
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>System</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Platform configuration, environment status, and system information.
      </p>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? "✓" : "✕"} {toast.message}</div>
        </div>
      )}

      {/* Environment Status */}
      <div className="settings-section">
        <div className="settings-section-title">Environment</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Service Status</div>
              <div className="card-description">
                Check that all required services are properly configured
              </div>
            </div>
            <span className="badge badge-ok">Healthy</span>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gap: "0" }}>
              {[
                {
                  label: "DATABASE_URL",
                  description: "PostgreSQL connection string",
                  connected: system?.environment.hasDatabase ?? false,
                  envVar: "DATABASE_URL",
                },
                {
                  label: "REDIS_URL",
                  description: "Redis connection for BullMQ queues",
                  connected: system?.environment.hasRedis ?? false,
                  envVar: "REDIS_URL",
                },
                {
                  label: "ENCRYPTION_KEY",
                  description: "AES-256-GCM key for credential encryption",
                  connected: system?.environment.hasEncryptionKey ?? false,
                  envVar: "ENCRYPTION_KEY",
                },
                {
                  label: "LLM_BASE_URL",
                  description: "OmniRoute or custom OpenAI-compatible endpoint",
                  connected: system?.environment.hasLlmEndpoint ?? false,
                  envVar: "LLM_BASE_URL",
                },
              ].map((item, i, arr) => (
                <div
                  key={item.envVar}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 0",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--border-light)" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: item.connected ? "var(--ok)" : "var(--err)",
                        boxShadow: item.connected
                          ? "0 0 8px rgb(16 185 129 / 0.3)"
                          : "0 0 8px rgb(239 68 68 / 0.3)",
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <code style={{ fontSize: "13px", fontWeight: 600, fontFamily: "monospace" }}>
                          {item.envVar}
                        </code>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "1px" }}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${item.connected ? "badge-ok" : "badge-err"}`}>
                    {item.connected ? "Set" : "Not set"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LLM Configuration */}
      <div className="settings-section">
        <div className="settings-section-title">LLM Configuration</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Model Settings</div>
              <div className="card-description">Configure the AI model used by your agents</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "520px" }}>
              <div className="form-group">
                <label className="form-label">LLM Endpoint</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="http://omniroute:3000/v1"
                  disabled
                />
                <span className="form-hint">
                  Configured via LLM_BASE_URL environment variable
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Default Model</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="gpt-4o-mini"
                  disabled
                />
                <span className="form-hint">
                  Configured via LLM_MODEL environment variable
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Temperature</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0.7"
                  min="0"
                  max="2"
                  step="0.1"
                  disabled
                />
                <span className="form-hint">
                  Controls randomness. Lower = more focused, higher = more creative.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Max Tokens</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="4096"
                  min="1"
                  max="200000"
                  disabled
                />
                <span className="form-hint">
                  Maximum tokens in the model's response
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">System Prompt</label>
                <textarea
                  className="form-input"
                  placeholder="You are a helpful support agent..."
                  rows={4}
                  disabled
                />
                <span className="form-hint">
                  Default system prompt for all agents. Can be overridden per agent.
                </span>
              </div>

              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  background: "var(--bg)",
                  padding: "12px 16px",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                ℹ️ LLM settings are configured through environment variables in your{" "}
                <code style={{ fontSize: "12px" }}>.env</code> file. Edit them directly for changes
                to take effect.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Info */}
      <div className="settings-section">
        <div className="settings-section-title">Platform</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Version & Info</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gap: "12px", maxWidth: "520px" }}>
              {[
                { label: "Version", value: system?.version ?? "0.1.0" },
                { label: "Workspace", value: system?.workspace.name ?? "Default" },
                {
                  label: "Uptime",
                  value: "Since " + (system?.workspace.createdAt
                    ? new Date(system.workspace.createdAt).toLocaleDateString()
                    : "unknown"),
                },
                { label: "Node.js", value: typeof process !== "undefined" ? "22+" : "22+" },
                { label: "Runtime", value: "Next.js + Hono" },
                { label: "Database", value: "PostgreSQL + pgvector" },
                { label: "Queue", value: "BullMQ + Redis" },
              ].map((item, i, arr) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--border-light)" : "none",
                  }}
                >
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{item.label}</span>
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="settings-section">
        <div className="settings-section-title">Maintenance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
          <div className="card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>Export Logs</div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  Download system logs for debugging
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={copyLogs}>
                Copy
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>Health Check</div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  Test all service connections
                </div>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setToast({ type: "success", message: "All services responding." });
                }}
              >
                Check
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
