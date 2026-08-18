import { CopyButton } from "../../components/channels/copy-button";
import { API_URL } from "../../lib/api";

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

const CHANNEL_NAMES: Record<string, string> = {
  messenger: "Messenger",
  instagram: "Instagram DM",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
  widget: "Web Widget",
};

function formatDate(iso: string | null): string {
  if (iso === null) {
    return "never";
  }
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ChannelsPage() {
  const { channels, secrets, error } = await loadChannels();

  return (
    <main style={{ maxWidth: "56rem", margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Channels</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>
          Connect Messenger, Instagram, WhatsApp, TikTok, and the web widget to your agents.
        </p>
      </div>

      {error !== undefined && (
        <div className="card" style={{ color: "var(--err)" }}>
          Could not load channels — {error}. Is the API running (<code>pnpm dev --filter api</code>
          )?
        </div>
      )}

      {channels !== undefined && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {channels.map((channel) => {
            const verified = channel.verifiedAt !== null;
            const failed = channel.lastError !== null;
            return (
              <div key={channel.channel} className="card">
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {CHANNEL_NAMES[channel.channel] ?? channel.channel}
                  </div>
                  {failed ? (
                    <span className="badge err">needs attention</span>
                  ) : verified ? (
                    <span className="badge ok">verified</span>
                  ) : (
                    <span className="badge muted">not connected</span>
                  )}
                </div>

                {failed && channel.lastError !== null && (
                  <div style={{ color: "var(--err)", fontSize: "13px", marginTop: "0.5rem" }}>
                    {channel.lastError}
                  </div>
                )}

                {channel.webhookUrl !== null && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginTop: "0.75rem",
                    }}
                  >
                    <code
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 13,
                      }}
                    >
                      {channel.webhookUrl}
                    </code>
                    <CopyButton value={channel.webhookUrl} />
                  </div>
                )}

                {channel.channel === "messenger" && secrets?.metaVerifyToken !== null && (
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "0.5rem" }}>
                    Verify token: <code>{secrets?.metaVerifyToken}</code>
                  </div>
                )}

                {channel.channel === "widget" && secrets?.widgetToken !== null && (
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "0.5rem" }}>
                    Widget token: <code>{secrets?.widgetToken}</code>
                  </div>
                )}

                <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "0.5rem" }}>
                  Last event: {formatDate(channel.lastEventAt)} · Verified:{" "}
                  {formatDate(channel.verifiedAt)}
                </div>

                <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "0.5rem" }}>
                  {channel.guidance}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
