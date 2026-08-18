"use client";

import { useCallback, useEffect, useState } from "react";

interface ChannelInfo {
  channel: string;
  webhookUrl: string | null;
  verified: boolean;
  lastEventAt: string | null;
  lastError: string | null;
}

interface Credential {
  id: string;
  channel: string;
  name: string;
  maskedHint: string;
  createdAt: string;
}

const CHANNEL_META: Record<string, { name: string; icon: string; description: string; color: string; bgColor: string }> = {
  messenger: { name: "Messenger", icon: "💬", description: "Facebook Messenger for customer conversations", color: "#0084ff", bgColor: "#e8f4fd" },
  instagram: { name: "Instagram DM", icon: "📸", description: "Instagram Direct Messages integration", color: "#e1306c", bgColor: "#fde8f0" },
  whatsapp: { name: "WhatsApp", icon: "📱", description: "WhatsApp Business API for messaging", color: "#25d366", bgColor: "#e8faf0" },
  tiktok: { name: "TikTok", icon: "🎵", description: "TikTok Business Messaging API", color: "#000000", bgColor: "#f1f1f1" },
  widget: { name: "Web Widget", icon: "🌐", description: "Embeddable chat widget for your website", color: "#6366f1", bgColor: "#eef0ff" },
};

export default function ChannelsSettingsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/channels", { credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as { channels: ChannelInfo[]; credentials: Credential[] };
        setChannels(data.channels);
        setCredentials(data.credentials);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setToast({ type: "success", message: "Copied to clipboard!" });
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
      <h1 style={{ marginBottom: "4px" }}>Channels</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Connect messaging platforms to your AI agents.
      </p>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? "✓" : "✕"} {toast.message}</div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">Available Channels</div>
        <div style={{ display: "grid", gap: "12px" }}>
          {Object.entries(CHANNEL_META).map(([key, meta]) => {
            const status = channels.find((ch) => ch.channel === key);
            const isConnected = status?.verified ?? false;
            const hasError = status?.lastError !== null;
            const channelCreds = credentials.filter((c) => c.channel === key);

            return (
              <div key={key} className="card" style={{ padding: "20px" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "12px" }}>
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: meta.bgColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "22px",
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "15px" }}>{meta.name}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{meta.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasError ? (
                      <span className="badge badge-err">Error</span>
                    ) : isConnected ? (
                      <span className="badge badge-ok">Connected</span>
                    ) : (
                      <span className="badge badge-muted">Not connected</span>
                    )}
                  </div>
                </div>

                {hasError && status?.lastError !== null && (
                  <div
                    style={{
                      background: "var(--err-light)",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "13px",
                      color: "var(--err)",
                      marginBottom: "12px",
                    }}
                  >
                    {status?.lastError}
                  </div>
                )}

                {status?.webhookUrl !== null && status?.webhookUrl !== undefined && (
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
                      Webhook URL
                    </div>
                    <div className="flex items-center gap-2">
                      <code
                        style={{
                          flex: 1,
                          background: "var(--bg)",
                          border: "1px solid var(--border-light)",
                          borderRadius: "var(--radius-sm)",
                          padding: "8px 12px",
                          fontSize: "12px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {status.webhookUrl}
                      </code>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => copyToClipboard(status.webhookUrl ?? "")}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                {channelCreds.length > 0 && (
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
                      Credentials
                    </div>
                    <div style={{ display: "grid", gap: "4px" }}>
                      {channelCreds.map((cred) => (
                        <div
                          key={cred.id}
                          className="flex items-center justify-between"
                          style={{
                            padding: "6px 12px",
                            background: "var(--bg)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "13px",
                          }}
                        >
                          <span>{cred.name}</span>
                          <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "12px" }}>
                            {cred.maskedHint}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status?.lastEventAt !== null && status?.lastEventAt !== undefined && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                    Last event: {new Date(status.lastEventAt).toLocaleString()}
                  </div>
                )}

                {key === "widget" && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      background: "var(--bg)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "13px",
                      fontFamily: "monospace",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {"<script src=\"/widget.js\" data-token=\"YOUR_TOKEN\"></script>"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
