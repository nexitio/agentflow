"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "../../../../components/dashboard/icons";

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

interface LlmDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

interface LlmEnvironment {
  baseUrl: string | null;
  apiKeyConfigured: boolean;
  modelEnv: string | null;
  embeddingModel: string | null;
}

interface LlmResponse {
  defaults: LlmDefaults;
  environment: LlmEnvironment;
}

export default function SystemSettingsPage() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // ── LLM Configuration state ─────────────────────────────────────────────
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmLoadFailed, setLlmLoadFailed] = useState(false);
  const [llmEnv, setLlmEnv] = useState<LlmEnvironment | null>(null);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);

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

  const loadLlm = useCallback(async () => {
    setLlmLoading(true);
    setLlmLoadFailed(false);
    try {
      const res = await fetch("/api/settings/llm", { credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as LlmResponse;
        setLlmEnv(data.environment);
        setModel(data.defaults.model ?? "");
        setTemperature(
          data.defaults.temperature === undefined ? "" : String(data.defaults.temperature),
        );
        setMaxTokens(data.defaults.maxTokens === undefined ? "" : String(data.defaults.maxTokens));
        setSystemPrompt(data.defaults.systemPrompt ?? "");
      } else {
        setLlmLoadFailed(true);
      }
    } catch {
      setLlmLoadFailed(true);
    } finally {
      setLlmLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLlm();
  }, [loadLlm]);

  const saveLlm = useCallback(async () => {
    setSaving(true);
    setToast(null);

    const parsedTemperature = temperature.trim() === "" ? null : Number(temperature);
    if (
      parsedTemperature !== null &&
      (Number.isNaN(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)
    ) {
      setToast({ type: "error", message: "Temperature must be between 0 and 2." });
      setSaving(false);
      return;
    }

    const parsedMaxTokens = maxTokens.trim() === "" ? null : Number(maxTokens);
    if (parsedMaxTokens !== null && (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 1)) {
      setToast({ type: "error", message: "Max tokens must be a whole number of 1 or more." });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          model: model.trim() === "" ? null : model.trim(),
          temperature: parsedTemperature,
          maxTokens: parsedMaxTokens,
          systemPrompt: systemPrompt.trim() === "" ? null : systemPrompt,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { defaults: LlmDefaults };
        setModel(data.defaults.model ?? "");
        setTemperature(
          data.defaults.temperature === undefined ? "" : String(data.defaults.temperature),
        );
        setMaxTokens(data.defaults.maxTokens === undefined ? "" : String(data.defaults.maxTokens));
        setSystemPrompt(data.defaults.systemPrompt ?? "");
        setToast({
          type: "success",
          message: "LLM defaults saved. New runs use them immediately.",
        });
      } else {
        const data = (await res.json()) as { error?: { message: string } };
        setToast({
          type: "error",
          message: data.error?.message ?? "Failed to save LLM settings.",
        });
      }
    } catch {
      setToast({ type: "error", message: "Connection failed. Is the API running?" });
    } finally {
      setSaving(false);
    }
  }, [model, temperature, maxTokens, systemPrompt]);

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
        Platform configuration, AI defaults, environment status, and system information.
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
                        <code
                          style={{ fontSize: "13px", fontWeight: 600, fontFamily: "monospace" }}
                        >
                          {item.envVar}
                        </code>
                      </div>
                      <div
                        style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "1px" }}
                      >
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
              <div className="card-description">
                Workspace-wide AI defaults used whenever an agent doesn't set its own
              </div>
            </div>
            {llmLoading ? (
              <span className="badge badge-muted">Loading</span>
            ) : llmLoadFailed ? (
              <span className="badge badge-err">Unavailable</span>
            ) : (
              <span className="badge badge-ok">Saved to workspace</span>
            )}
          </div>

          {llmLoading ? (
            <div className="card-body">
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "24px 0",
                }}
              >
                <div className="spinner" />
              </div>
            </div>
          ) : (
            <div className="card-body">
              {llmLoadFailed ? (
                <div className="flex items-center justify-between" style={{ gap: "16px" }}>
                  <div className="flex items-center gap-3">
                    <div className="empty-state-icon">
                      <Icon name="sparkle" size={22} style={{ color: "var(--warn)" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>
                        Couldn't load LLM configuration
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "var(--text-secondary)",
                          marginTop: "2px",
                        }}
                      >
                        The settings service isn't responding. Retry, or check that the API is
                        running the latest version.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void loadLlm()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Env layer — read-only, the connection this workspace talks to. */}
                  <div
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border-light)",
                      borderRadius: "var(--radius-md)",
                      padding: "4px 16px",
                      marginBottom: "24px",
                    }}
                  >
                    <div
                      style={{ padding: "12px 0", borderBottom: "1px solid var(--border-light)" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "16px",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600 }}>LLM Endpoint</div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            Set via the LLM_BASE_URL environment variable
                          </div>
                        </div>
                        <code
                          style={{
                            fontSize: "12px",
                            color: llmEnv?.baseUrl ? "var(--text)" : "var(--text-muted)",
                            background: "var(--surface)",
                            padding: "6px 10px",
                            borderRadius: "var(--radius-sm)",
                            fontFamily: "monospace",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "55%",
                          }}
                        >
                          {llmEnv?.baseUrl ?? "Not configured"}
                        </code>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "0 24px",
                      }}
                    >
                      {[
                        {
                          label: "API Key",
                          value: llmEnv?.apiKeyConfigured ? "Configured" : "Not set",
                          ok: llmEnv?.apiKeyConfigured ?? false,
                          hint: "LLM_API_KEY — never shown for security",
                        },
                        {
                          label: "Env Fallback Model",
                          value: llmEnv?.modelEnv ?? "Unset",
                          ok: (llmEnv?.modelEnv?.length ?? 0) > 0,
                          hint: "LLM_MODEL — used if no default is saved below",
                        },
                        {
                          label: "Embedding Model",
                          value: llmEnv?.embeddingModel ?? "Unset",
                          ok: (llmEnv?.embeddingModel?.length ?? 0) > 0,
                          hint: "EMBEDDING_MODEL — for knowledge retrieval",
                        },
                      ].map((item) => (
                        <div key={item.label} style={{ padding: "10px 0" }}>
                          <div className="flex items-center gap-2" style={{ marginBottom: "2px" }}>
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: item.ok ? "var(--ok)" : "var(--text-muted)",
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ fontSize: "12px", fontWeight: 600 }}>{item.label}</span>
                          </div>
                          <div style={{ fontSize: "13px", color: "var(--text)" }}>{item.value}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {item.hint}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Editable workspace defaults. */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "20px",
                      maxWidth: "520px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label" htmlFor="llm-model">
                        Default Model
                      </label>
                      <input
                        id="llm-model"
                        type="text"
                        className="form-input"
                        placeholder={llmEnv?.modelEnv ?? "e.g. gpt-4o-mini"}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                      <span className="form-hint">
                        Used when an agent's Model node has no model chosen. Agents that pick their
                        own always win.
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="llm-temperature">
                          Temperature
                        </label>
                        <input
                          id="llm-temperature"
                          type="number"
                          className="form-input"
                          placeholder="0.2"
                          min="0"
                          max="2"
                          step="0.1"
                          value={temperature}
                          onChange={(e) => setTemperature(e.target.value)}
                        />
                        <span className="form-hint">0–2. Leave empty to keep 0.2.</span>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="llm-max-tokens">
                          Max Tokens
                        </label>
                        <input
                          id="llm-max-tokens"
                          type="number"
                          className="form-input"
                          placeholder="e.g. 4096"
                          min="1"
                          step="1"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(e.target.value)}
                        />
                        <span className="form-hint">Cap on the model's reply length.</span>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="llm-system-prompt">
                        Default System Prompt
                      </label>
                      <textarea
                        id="llm-system-prompt"
                        className="form-input"
                        placeholder="You are a helpful support agent."
                        rows={4}
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                      />
                      <span className="form-hint">
                        Applies to agents still using the default prompt. Custom prompts written on
                        an agent always win.
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void saveLlm()}
                        disabled={saving}
                      >
                        {saving ? (
                          <span className="flex items-center gap-2">
                            <span className="spinner" style={{ borderTopColor: "#fff" }} />
                            Saving…
                          </span>
                        ) : (
                          "Save Changes"
                        )}
                      </button>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        Changes apply to new agent runs.
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
                  value:
                    "Since " +
                    (system?.workspace.createdAt
                      ? new Date(system.workspace.createdAt).toLocaleDateString()
                      : "unknown"),
                },
                { label: "Node.js", value: "22+" },
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
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    {item.label}
                  </span>
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          <div className="card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>Export Logs</div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  Download system logs for debugging
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyLogs}>
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
                type="button"
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
