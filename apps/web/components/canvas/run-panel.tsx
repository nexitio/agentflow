"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../../lib/api";

interface RunResult {
  id: string;
  status: "succeeded" | "failed";
  nodeOutputs: Record<
    string,
    {
      status: "success" | "error";
      output?: unknown;
      branch?: string;
      error?: { code: string; message: string };
    }
  >;
  timings: Record<string, { startedAt: string; finishedAt: string; durationMs: number }>;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: { code: string; message: string; nodeId?: string };
}

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
}

export function RunPanel({ flowId }: { flowId: string }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const body = await apiFetch<{ runs: RunSummary[] }>(`/api/flows/${flowId}/runs`);
      setHistory(body.runs);
    } catch {
      // History is best-effort; the run result itself reports errors.
    }
  }, [flowId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  async function run() {
    setBusy(true);
    setResult(null);
    setMessage(null);
    try {
      const body = await apiFetch<{ run: RunResult }>(`/api/flows/${flowId}/runs`, {
        method: "POST",
        body: JSON.stringify({ input: { text: input } }),
      });
      setResult(body.run);
      void refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ fontWeight: 700, fontSize: "13px" }}>Run test</div>
      <textarea
        rows={2}
        placeholder="Test message, e.g. “I want a refund”"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <button type="button" className="primary" onClick={() => void run()} disabled={busy}>
        {busy ? "Running…" : "▶ Run"}
      </button>

      {message !== null && (
        <div className="badge err" style={{ alignSelf: "start" }}>
          {message}
        </div>
      )}

      {result !== null && (
        <div style={{ display: "grid", gap: "0.4rem", fontSize: "13px" }}>
          <div>
            Status:{" "}
            <span className={`badge ${result.status === "succeeded" ? "ok" : "err"}`}>
              {result.status}
            </span>
            {result.error !== undefined && (
              <div style={{ color: "var(--err)", marginTop: "4px" }}>
                {result.error.code}: {result.error.message}
              </div>
            )}
          </div>
          {Object.entries(result.nodeOutputs).map(([nodeId, record]) => (
            <div
              key={nodeId}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 8px",
                background: "var(--bg)",
              }}
            >
              <div>
                <strong>{nodeId}</strong>{" "}
                <span className={`badge ${record.status === "success" ? "ok" : "err"}`}>
                  {record.status}
                </span>
                {record.branch !== undefined && (
                  <span className="badge muted" style={{ marginLeft: 4 }}>
                    → {record.branch}
                  </span>
                )}
              </div>
              {record.status === "success" && record.output !== undefined && (
                <pre
                  style={{
                    margin: "4px 0 0",
                    fontSize: "11px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "var(--muted)",
                  }}
                >
                  {JSON.stringify(record.output, null, 2)}
                </pre>
              )}
              {record.status === "error" && record.error !== undefined && (
                <div style={{ color: "var(--err)", fontSize: "12px", marginTop: "2px" }}>
                  {record.error.code}: {record.error.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: "4px",
            }}
          >
            RECENT RUNS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {history.map((run) => (
              <span key={run.id} className={`badge ${run.status === "succeeded" ? "ok" : "err"}`}>
                {new Date(run.createdAt).toLocaleTimeString()} · {run.status}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
