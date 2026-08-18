"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  "user.login": { label: "Login", color: "var(--ok)", bgColor: "var(--ok-light)" },
  "user.logout": { label: "Logout", color: "var(--text-secondary)", bgColor: "#f1f2f7" },
  "user.register": { label: "Register", color: "var(--info)", bgColor: "var(--info-light)" },
  "totp.enable": { label: "2FA Enabled", color: "var(--ok)", bgColor: "var(--ok-light)" },
  "totp.disable": { label: "2FA Disabled", color: "var(--warn)", bgColor: "var(--warn-light)" },
  "passkey.register": { label: "Passkey Added", color: "var(--info)", bgColor: "var(--info-light)" },
  "passkey.delete": { label: "Passkey Removed", color: "var(--err)", bgColor: "var(--err-light)" },
  "workspace.update": { label: "Workspace Updated", color: "var(--accent)", bgColor: "var(--accent-light)" },
  "agent.update": { label: "Agent Updated", color: "var(--accent)", bgColor: "var(--accent-light)" },
  "agent.delete": { label: "Agent Deleted", color: "var(--err)", bgColor: "var(--err-light)" },
  "knowledge.delete": { label: "Knowledge Deleted", color: "var(--err)", bgColor: "var(--err-light)" },
  "apikey.create": { label: "API Key Created", color: "var(--info)", bgColor: "var(--info-light)" },
  "apikey.delete": { label: "API Key Revoked", color: "var(--err)", bgColor: "var(--err-light)" },
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/audit?limit=${limit}&offset=${page * limit}`, {
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as { logs: AuditEntry[]; total: number };
        setLogs(data.logs);
        setTotal(data.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>Audit Log</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Track all actions taken in your workspace for security and compliance.
      </p>

      <div className="settings-section">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : logs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No audit entries</div>
              <div className="empty-state-text">
                Actions will appear here as you use the platform.
              </div>
            </div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Time</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => {
                    const actionMeta = ACTION_LABELS[entry.action] ?? {
                      label: entry.action,
                      color: "var(--text-secondary)",
                      bgColor: "#f1f2f7",
                    };

                    return (
                      <tr key={entry.id}>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: actionMeta.bgColor,
                              color: actionMeta.color,
                              fontWeight: 500,
                            }}
                          >
                            {actionMeta.label}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: "13px" }}>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {entry.resourceType}
                            </span>
                            {entry.resourceId !== null && (
                              <code
                                style={{
                                  marginLeft: "6px",
                                  fontSize: "11px",
                                  background: "var(--bg)",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  fontFamily: "monospace",
                                }}
                              >
                                {entry.resourceId.slice(0, 8)}…
                              </code>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                          {new Date(entry.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td>
                          <code
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                              fontFamily: "monospace",
                            }}
                          >
                            {entry.ip ?? "—"}
                          </code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div
                  className="flex items-center justify-between"
                  style={{ padding: "12px 16px", borderTop: "1px solid var(--border-light)" }}
                >
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                    Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
