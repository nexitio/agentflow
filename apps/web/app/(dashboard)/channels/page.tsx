import { CopyButton } from "../../../components/channels/copy-button";
import { Icon } from "../../../components/dashboard/icons";
import { API_URL } from "../../../lib/api";

export const dynamic = "force-dynamic";

interface ChannelStatus {
  channel: string;
  webhookUrl: string | null;
  verifiedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  guidance: string;
}

interface ChannelsResult {
  channels?: ChannelStatus[];
  secrets?: { metaVerifyToken: string | null; widgetToken: string | null };
  error?: string;
}

async function loadChannels(): Promise<ChannelsResult> {
  try {
    const response = await fetch(`${API_URL}/api/channels`, { cache: "no-store" });
    if (!response.ok) {
      return { error: `API returned ${response.status}` };
    }
    const body = (await response.json()) as {
      channels: ChannelStatus[];
      secrets: { metaVerifyToken: string | null; widgetToken: string | null };
    };
    return body;
  } catch {
    return { error: "API unreachable" };
  }
}

const CHANNEL_META: Record<
  string,
  { name: string; icon: string; description: string; color: string; bg: string }
> = {
  messenger: {
    name: "Messenger",
    icon: "💬",
    description: "Facebook Messenger conversations",
    color: "#0a8cff",
    bg: "rgb(10 140 255 / 0.12)",
  },
  instagram: {
    name: "Instagram DM",
    icon: "📸",
    description: "Direct messages from Instagram",
    color: "#e1306c",
    bg: "rgb(225 48 108 / 0.12)",
  },
  whatsapp: {
    name: "WhatsApp",
    icon: "💬",
    description: "WhatsApp Business messaging",
    color: "#12b76a",
    bg: "rgb(18 183 106 / 0.12)",
  },
  tiktok: {
    name: "TikTok",
    icon: "🎵",
    description: "TikTok Business Messaging",
    color: "#0b0b16",
    bg: "rgb(139 143 163 / 0.16)",
  },
  widget: {
    name: "Web Widget",
    icon: "🌐",
    description: "Embeddable chat widget for your site",
    color: "#6366f1",
    bg: "rgb(99 102 241 / 0.12)",
  },
};

function formatDate(iso: string | null): string {
  if (iso === null) return "never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ChannelsPage() {
  const { channels, secrets, error } = await loadChannels();
  const verifiedCount = channels?.filter((c) => c.verifiedAt !== null).length ?? 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div>
          <div className="flex items-center" style={{ gap: 10, marginBottom: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Channels
            </h1>
            {channels !== undefined && verifiedCount > 0 && (
              <span className="badge badge-ok" style={{ fontSize: 11.5 }}>
                {verifiedCount} connected
              </span>
            )}
          </div>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Connect Messenger, Instagram, WhatsApp, TikTok and the web widget to your published
            agents. Webhook URLs below are the exact values to paste into the provider dashboard.
          </p>
        </div>
      </div>

      {error !== undefined && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--err-light)",
            color: "var(--err-strong)",
            fontSize: 13.5,
            fontWeight: 550,
            marginBottom: 20,
          }}
        >
          <Icon name="activity" size={17} />
          <span>
            Could not load channels — {error}. Is the API running (
            <code style={{ background: "transparent", border: "none" }}>pnpm dev --filter api</code>
            )?
          </span>
        </div>
      )}

      {channels !== undefined && (
        <div style={{ display: "grid", gap: 14 }}>
          {channels.map((channel, index) => {
            const meta = CHANNEL_META[channel.channel] ?? {
              name: channel.channel,
              icon: "🔌",
              description: "",
              color: "var(--text-muted)",
              bg: "var(--surface-2)",
            };
            const verified = channel.verifiedAt !== null;
            const failed = channel.lastError !== null;
            const needsSetup = channel.webhookUrl !== null || verified;

            return (
              <div
                key={channel.channel}
                className="card"
                style={{
                  padding: "18px 20px",
                  animation: "riseIn 480ms var(--ease-spring) both",
                  animationDelay: `${index * 55}ms`,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div className="flex items-center justify-between" style={{ gap: 14 }}>
                  <div className="flex items-center" style={{ gap: 14, minWidth: 0 }}>
                    <div
                      className="tile-icon"
                      style={{
                        background: meta.bg,
                        color: meta.color,
                        width: 46,
                        height: 46,
                        borderRadius: 15,
                        fontSize: 21,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 680, fontSize: 15.5 }}>{meta.name}</div>
                      <div
                        className="truncate"
                        style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 1 }}
                      >
                        {meta.description} · {channel.guidance}
                      </div>
                    </div>
                  </div>
                  {failed ? (
                    <span className="badge badge-err">Needs attention</span>
                  ) : verified ? (
                    <span className="badge badge-ok">Connected</span>
                  ) : (
                    <span className="badge badge-muted">Not connected</span>
                  )}
                </div>

                {failed && channel.lastError !== null && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--err-light)",
                      color: "var(--err-strong)",
                      fontSize: 13,
                      fontWeight: 550,
                    }}
                  >
                    {channel.lastError}
                  </div>
                )}

                {needsSetup && (
                  <div
                    style={{
                      borderRadius: "var(--radius-sm)",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border-light)",
                      padding: "12px 14px",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        Webhook URL
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        Last event: {formatDate(channel.lastEventAt)}
                      </span>
                    </div>
                    {channel.webhookUrl !== null ? (
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <code
                          className="truncate"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            background: "var(--surface)",
                            border: "1px solid var(--border-light)",
                            borderRadius: 8,
                            padding: "8px 11px",
                            fontSize: 12.5,
                          }}
                        >
                          {channel.webhookUrl}
                        </code>
                        <CopyButton value={channel.webhookUrl} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        Webhook URL appears once the channel is registered.
                      </span>
                    )}

                    {channel.channel === "messenger" && secrets?.metaVerifyToken !== null && (
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span
                          style={{ fontSize: 12.5, color: "var(--text-secondary)", flexShrink: 0 }}
                        >
                          Verify token
                        </span>
                        <code
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--border-light)",
                            borderRadius: 8,
                            padding: "7px 11px",
                            fontSize: 12,
                          }}
                        >
                          {secrets?.metaVerifyToken}
                        </code>
                        <CopyButton value={secrets?.metaVerifyToken ?? ""} />
                      </div>
                    )}

                    {channel.channel === "widget" && secrets?.widgetToken !== null && (
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span
                          style={{ fontSize: 12.5, color: "var(--text-secondary)", flexShrink: 0 }}
                        >
                          Widget token
                        </span>
                        <code
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--border-light)",
                            borderRadius: 8,
                            padding: "7px 11px",
                            fontSize: 12,
                          }}
                        >
                          {secrets?.widgetToken}
                        </code>
                        <CopyButton value={secrets?.widgetToken ?? ""} />
                      </div>
                    )}

                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Verified: {formatDate(channel.verifiedAt)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
