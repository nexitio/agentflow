"use client";

import { useCallback, useEffect, useState } from "react";

interface KnowledgeSource {
  sourceId: string;
  title: string;
  count: number;
  createdAt: string;
}

export default function KnowledgeSettingsPage() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/knowledge", { credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as { sources: KnowledgeSource[] };
        setSources(data.sources);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const deleteSource = useCallback(
    async (sourceId: string) => {
      try {
        const res = await fetch(`/api/settings/knowledge/${sourceId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (res.ok) {
          setToast({ type: "success", message: "Document removed from knowledge base." });
          setDeleteConfirm(null);
          void loadSources();
        }
      } catch {
        setToast({ type: "error", message: "Failed to delete." });
      }
    },
    [loadSources],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setToast(null);

      // In a full implementation, this would upload the file to the API
      // For now, show a message
      setToast({
        type: "info" as "success",
        message: "Document upload will be available once the ingestion pipeline is connected.",
      });
      setUploading(false);
      e.target.value = "";
    },
    [],
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
      <h1 style={{ marginBottom: "4px" }}>Knowledge Base</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Manage documents your agents can reference when answering questions.
      </p>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type === "info" ? "info" : toast.type}`}>
            {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"} {toast.message}
          </div>
        </div>
      )}

      {/* Upload Section */}
      <div className="settings-section">
        <div className="settings-section-title">Upload Documents</div>
        <div className="card">
          <div
            style={{
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius)",
              padding: "40px",
              textAlign: "center",
              transition: "all var(--transition-base)",
              cursor: "pointer",
            }}
            onClick={() => document.getElementById("file-upload")?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") document.getElementById("file-upload")?.click();
            }}
            role="button"
            tabIndex={0}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📄</div>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>
              {uploading ? "Uploading…" : "Drop files here or click to upload"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Supports PDF, TXT, Markdown, and HTML files
            </div>
            <input
              id="file-upload"
              type="file"
              accept=".pdf,.txt,.md,.html"
              style={{ display: "none" }}
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </div>
        </div>
      </div>

      {/* Existing Sources */}
      <div className="settings-section">
        <div className="settings-section-title">Documents ({sources.length})</div>

        {sources.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">📚</div>
              <div className="empty-state-title">No documents yet</div>
              <div className="empty-state-text">
                Upload documents to give your agents knowledge to reference.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sources.map((source) => (
              <div key={source.sourceId} className="card" style={{ padding: "14px 20px" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "var(--info-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                      }}
                    >
                      📄
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px" }}>{source.title}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {source.count} chunk{source.count === 1 ? "" : "s"} · added{" "}
                        {new Date(source.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                  </div>

                  {deleteConfirm === source.sourceId ? (
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "12px", color: "var(--err)" }}>Remove?</span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void deleteSource(source.sourceId)}
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
                      onClick={() => setDeleteConfirm(source.sourceId)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="settings-section">
        <div className="card" style={{ background: "var(--info-light)", borderColor: "var(--info-light)" }}>
          <div className="flex items-center gap-3">
            <div style={{ fontSize: "20px" }}>💡</div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              <strong>How knowledge works:</strong> Uploaded documents are split into chunks and
              embedded using your configured embedding model. When a customer asks a question, the
              agent searches for relevant chunks and includes them as context in its response.
              Retrieved content is always treated as untrusted data.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
