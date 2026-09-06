"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../lib/api";
import { Icon, type IconName } from "../dashboard/icons";

interface FlowSummary {
  flowId: string;
  name: string;
  draftVersion: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  runCount: number;
}

interface ChannelStatus {
  channel: string;
  webhookUrl: string | null;
  verifiedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  guidance: string;
}

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

const CHANNEL_META: Record<string, { name: string; color: string; bg: string }> = {
  messenger: { name: "Messenger", color: "#0a8cff", bg: "rgb(10 140 255 / 0.14)" },
  instagram: { name: "Instagram", color: "#e1306c", bg: "rgb(225 48 108 / 0.14)" },
  whatsapp: { name: "WhatsApp", color: "#12b76a", bg: "rgb(18 183 106 / 0.14)" },
  tiktok: { name: "TikTok", color: "#8a8fa3", bg: "rgb(138 143 163 / 0.2)" },
  widget: { name: "Web Widget", color: "#6366f1", bg: "rgb(99 102 241 / 0.14)" },
};

interface ChecklistCtx {
  flows: FlowSummary[];
  channels: ChannelStatus[];
}

const CHECKLIST: Array<{
  label: string;
  hint: string;
  href: string;
  done: (ctx: ChecklistCtx) => boolean;
}> = [
  {
    label: "Publish your first agent",
    hint: "Snapshot the flow so it can run",
    href: "/flows",
    done: (d) => d.flows.some((f) => f.publishedVersion !== null),
  },
  {
    label: "Connect a channel",
    hint: "Messenger, Instagram, WhatsApp or TikTok",
    href: "/channels",
    done: (d) => d.channels.some((c) => c.verifiedAt !== null),
  },
  {
    label: "Run a live test",
    hint: "Execute the published flow once",
    href: "/flows",
    done: (d) => d.flows.some((f) => f.runCount > 0),
  },
  {
    label: "Put the widget live",
    hint: "Embed the chat widget on your site",
    href: "/channels",
    done: (d) => d.channels.some((c) => c.channel === "widget" && c.verifiedAt !== null),
  },
];

interface OverviewData {
  loading: boolean;
  offline: boolean;
  flows: FlowSummary[];
  channels: ChannelStatus[];
  system: SystemInfo | null;
  firstName: string;
  knowledgeCount: number;
}

function useCountUp(target: number, active: boolean, duration = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration]);
  return value;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StatCard({
  label,
  value,
  icon,
  color,
  bg,
  bars,
  foot,
  index,
  countUp,
}: {
  label: string;
  value: string | number;
  icon: IconName;
  color: string;
  bg: string;
  bars: number[];
  foot: string;
  index: number;
  countUp?: boolean;
}) {
  const numeric = typeof value === "number" ? value : NaN;
  const animated = countUp === true && Number.isFinite(numeric);
  const shown = useCountUp(animated ? numeric : 0, animated);
  const display = animated ? shown.toLocaleString() : value;

  const vars = {
    "--stat-color": color,
    "--stat-bg": bg,
    "--stat-glow": `color-mix(in srgb, ${color} 12%, transparent)`,
    animationDelay: `${120 + index * 70}ms`,
  } as CSSProperties;

  return (
    <div className="stat-card" style={vars}>
      <div className="stat-top">
        <span className="stat-icon">
          <Icon name={icon} size={19} />
        </span>{" "}
        <div className="stat-bars">
          {bars.map((height, i) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative sparkline bars
            return <span key={i} style={{ height: `${height}%`, ["--i" as string]: i }} />;
          })}
        </div>
      </div>
      <div className="stat-value">{display}</div>
      <div className="stat-label" style={{ marginTop: 8 }}>
        {label}
      </div>
      <div className="stat-foot">
        <span className="truncate">{foot}</span>
      </div>
    </div>
  );
}

function SkeletonPanel({ height = 120, delay = 0 }: { height?: number; delay?: number }) {
  return (
    <div
      className="skeleton"
      style={{ height, animationDelay: `${delay}ms`, animation: `fadeIn 200ms ease both` }}
    />
  );
}

export function OverviewDashboard() {
  const [data, setData] = useState<OverviewData>({
    loading: true,
    offline: false,
    flows: [],
    channels: [],
    system: null,
    firstName: "",
    knowledgeCount: 0,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let firstName = "";
      const [me, flowsRes, channelsRes, systemRes, knowledgeRes] = await Promise.allSettled([
        fetch("/api/auth/me", { credentials: "same-origin" }),
        fetch("/api/flows", { credentials: "same-origin" }),
        fetch("/api/channels", { credentials: "same-origin" }),
        fetch("/api/settings/system", { credentials: "same-origin" }),
        fetch("/api/settings/knowledge", { credentials: "same-origin" }),
      ]);

      if (me.status === "fulfilled" && me.value.ok) {
        const body = (await me.value.json()) as { user?: { name?: string } };
        firstName = body.user?.name?.split(/\s+/)[0] ?? "";
      }

      const flows =
        flowsRes.status === "fulfilled" && flowsRes.value.ok
          ? ((await flowsRes.value.json()) as { flows: FlowSummary[] }).flows
          : [];
      const channels =
        channelsRes.status === "fulfilled" && channelsRes.value.ok
          ? ((await channelsRes.value.json()) as { channels: ChannelStatus[] }).channels
          : [];
      const system =
        systemRes.status === "fulfilled" && systemRes.value.ok
          ? ((await systemRes.value.json()) as SystemInfo)
          : null;
      const knowledgeSources =
        knowledgeRes.status === "fulfilled" && knowledgeRes.value.ok
          ? (((await knowledgeRes.value.json()) as { sources: unknown[] }).sources ?? [])
          : [];

      const offline =
        flowsRes.status === "rejected" ||
        (flowsRes.status === "fulfilled" && !flowsRes.value.ok && flows.length === 0) ||
        systemRes.status === "rejected";

      if (!cancelled) {
        setData({
          loading: false,
          offline,
          flows,
          channels,
          system,
          firstName,
          knowledgeCount: knowledgeSources.length,
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const derived = useMemo(() => {
    const publishedCount = data.flows.filter((f) => f.publishedVersion !== null).length;
    const totalRuns = data.flows.reduce((sum, f) => sum + f.runCount, 0);
    const verifiedChannels = data.channels.filter((c) => c.verifiedAt !== null).length;
    const erroredChannels = data.channels.filter((c) => c.lastError !== null).length;
    const widgetLive = data.channels.some((c) => c.channel === "widget" && c.verifiedAt !== null);
    const checklistDone = CHECKLIST.filter((item) => item.done(data)).length;
    return {
      publishedCount,
      totalRuns,
      verifiedChannels,
      erroredChannels,
      widgetLive,
      checklistDone,
      checklistTotal: CHECKLIST.length,
    };
  }, [data]);

  const createAgent = async () => {
    setCreating(true);
    try {
      const body = await apiFetch<{ flow: { flowId: string } }>("/api/flows", {
        method: "POST",
        body: JSON.stringify({ name: "Untitled agent" }),
      });
      window.location.href = `/flows/${body.flow.flowId}`;
    } catch {
      setCreating(false);
    }
  };

  const { loading, offline } = data;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (loading) {
    return (
      <div>
        <SkeletonPanel height={72} />
        <div className="stat-grid" style={{ marginTop: 28 }}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonPanel key={i} height={132} delay={i * 60} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20, marginTop: 28 }}>
          <SkeletonPanel height={320} delay={120} />
          <SkeletonPanel height={320} delay={200} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              fontWeight: 650,
              color: "var(--text-muted)",
              letterSpacing: "0.01em",
              marginBottom: 8,
            }}
          >
            <span>{today}</span>
            {derived.publishedCount > 0 && (
              <>
                <span style={{ opacity: 0.5 }}>·</span>
                <span className="badge badge-ok" style={{ padding: "2px 9px" }}>
                  All systems live
                </span>
              </>
            )}
          </div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            {greeting()}
            {data.firstName !== "" ? `, ${data.firstName}` : ""}
            <span style={{ color: "var(--text-muted)" }}>.</span>
          </h1>
          <p className="page-subtitle">
            {data.system !== null
              ? `${data.system.workspace.name} — here is what is happening across your agents today.`
              : "Here is what is happening across your support agents today."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/flows" className="btn btn-secondary btn-lg">
            <Icon name="bot" size={16} />
            Manage agents
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void createAgent()}
            disabled={creating}
          >
            <Icon name="plus" size={16} />
            {creating ? "Creating…" : "New agent"}
          </button>
        </div>
      </div>

      {offline && (
        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderRadius: "var(--radius-lg)",
            background: "var(--warn-light)",
            color: "var(--warn)",
            fontSize: 13,
            fontWeight: 550,
            border: "1px solid color-mix(in srgb, var(--warn) 22%, transparent)",
          }}
        >
          <Icon name="activity" size={17} />
          The API looks unreachable — showing what is available. Start it with{" "}
          <code style={{ background: "transparent", border: "none" }}>pnpm dev --filter api</code>.
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────────────────── */}
      <div className="stat-grid" style={{ marginTop: 28 }}>
        <StatCard
          index={0}
          label="Agents"
          value={data.flows.length}
          countUp
          icon="bot"
          color="var(--accent)"
          bg="var(--accent-100)"
          bars={[40, 70, 52, 88, 64, 96, 78]}
          foot={`${derived.publishedCount} published`}
        />
        <StatCard
          index={1}
          label="Total runs"
          value={derived.totalRuns}
          countUp
          icon="activity"
          color="var(--ok)"
          bg="var(--ok-light)"
          bars={[30, 48, 60, 44, 72, 90, 84]}
          foot="executions persisted"
        />
        <StatCard
          index={2}
          label="Channels connected"
          value={derived.verifiedChannels}
          countUp
          icon="radio"
          color="var(--info)"
          bg="var(--info-light)"
          bars={[52, 40, 74, 58, 90, 68, 100]}
          foot={
            derived.erroredChannels > 0
              ? `${derived.erroredChannels} need attention`
              : "of 5 available channels"
          }
        />
        <StatCard
          index={3}
          label="Knowledge sources"
          value={data.knowledgeCount}
          countUp
          icon="book"
          color="var(--warn)"
          bg="var(--warn-light)"
          bars={[70, 88, 46, 92, 60, 80, 96]}
          foot="uploaded documents"
        />
      </div>

      {/* ── Main grid ────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.65fr) minmax(300px, 1fr)",
          gap: 20,
          alignItems: "start",
          marginTop: 34,
        }}
      >
        {/* Agents */}
        <section>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div>
              <h2>Your agents</h2>
              <p className="section-sub">
                {data.flows.length === 0
                  ? "Design a support agent on the canvas, then publish it."
                  : `Showing ${Math.min(data.flows.length, 4)} of ${data.flows.length}`}
              </p>
            </div>
            <Link href="/flows" className="section-link">
              View all
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          {data.flows.length === 0 ? (
            <div
              style={{
                border: "1.5px dashed var(--border-strong)",
                borderRadius: "var(--radius-xl)",
                padding: "44px 24px",
                textAlign: "center",
                background: "color-mix(in srgb, var(--surface) 55%, transparent)",
              }}
            >
              <div
                className="animate-float"
                style={{ width: 64, height: 64, margin: "0 auto 16px" }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    background: "var(--accent-gradient)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    boxShadow: "0 14px 34px -8px var(--accent-glow)",
                  }}
                >
                  <Icon name="sparkle" size={28} />
                </div>
              </div>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Build your first AI agent</h3>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 13.5,
                  maxWidth: 380,
                  margin: "0 auto 20px",
                }}
              >
                Drag a trigger onto the canvas, attach an agent node with a model and knowledge,
                then publish. It takes about ten minutes.
              </p>
              <div className="flex" style={{ justifyContent: "center", gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void createAgent()}
                  disabled={creating}
                >
                  <Icon name="plus" size={15} />
                  New agent
                </button>
                <Link href="/flows" className="btn btn-secondary">
                  Open the canvas
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {data.flows.slice(0, 4).map((flow, i) => {
                const published = flow.publishedVersion !== null;
                return (
                  <Link
                    key={flow.flowId}
                    href={`/flows/${flow.flowId}`}
                    className="card-link"
                    style={{
                      padding: "14px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      animationDelay: `${i * 60}ms`,
                    }}
                  >
                    <div
                      className="tile-icon"
                      style={{
                        background: published ? "var(--ok-light)" : "var(--accent-100)",
                        color: published ? "var(--ok-strong)" : "var(--accent)",
                      }}
                    >
                      <Icon name="bot" size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 650, fontSize: 14.5 }}>{flow.name}</span>
                        {published ? (
                          <span
                            className="badge badge-ok"
                            style={{ fontSize: 11, padding: "2px 9px" }}
                          >
                            v{flow.publishedVersion}
                          </span>
                        ) : (
                          <span
                            className="badge badge-muted"
                            style={{ fontSize: 11, padding: "2px 9px" }}
                          >
                            draft
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                        {flow.runCount} run{flow.runCount === 1 ? "" : "s"} · updated{" "}
                        {new Date(flow.updatedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <Icon name="chevronsRight" size={16} style={{ color: "var(--text-muted)" }} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Right rail */}
        <div style={{ display: "grid", gap: 20 }}>
          {/* Launch checklist */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Launch checklist</div>
              <span
                className="badge badge-accent badge-dotless"
                style={{ fontSize: 11, padding: "2px 9px" }}
              >
                {derived.checklistDone}/{derived.checklistTotal} done
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>
              Get your first agent answering real customers.
            </p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${(derived.checklistDone / derived.checklistTotal) * 100}%` }}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              {CHECKLIST.map((item) => {
                const done = item.done(data);
                return (
                  <Link
                    href={item.href}
                    key={item.label}
                    className="checklist-item"
                    style={{ color: "var(--text)" }}
                  >
                    <span className={`checklist-dot ${done ? "done" : "todo"}`}>
                      {done && <Icon name="check" size={12} strokeWidth={2.6} />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>
                        {item.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {item.hint}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Channels */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Channels</div>
              <Link
                href="/channels"
                className="section-link"
                style={{ padding: "2px 6px", fontSize: 12.5 }}
              >
                Configure
                <Icon name="arrowRight" size={13} />
              </Link>
            </div>
            {data.channels.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
                No channel data yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {data.channels.map((channel) => {
                  const meta = CHANNEL_META[channel.channel] ?? {
                    name: channel.channel,
                    color: "var(--text-muted)",
                    bg: "var(--surface-2)",
                  };
                  const ok = channel.verifiedAt !== null;
                  const err = channel.lastError !== null;
                  return (
                    <div
                      key={channel.channel}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: ok ? "var(--ok-light)" : "var(--surface-2)",
                        border: "1px solid var(--border-light)",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: err
                            ? "var(--err)"
                            : ok
                              ? "var(--ok)"
                              : "var(--border-strong)",
                          boxShadow: ok ? "0 0 0 3px var(--ok-light)" : undefined,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          background: meta.bg,
                          color: meta.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          flexShrink: 0,
                        }}
                      >
                        <Icon name="radio" size={14} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {meta.name}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 12,
                          fontWeight: 600,
                          color: err ? "var(--err)" : ok ? "var(--ok-strong)" : "var(--text-muted)",
                        }}
                      >
                        {err ? "attention" : ok ? "connected" : "off"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── System footer ────────────────────────────────────────── */}
      <div style={{ marginTop: 34 }}>
        <div
          className="card"
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            <Icon name="server" size={16} style={{ color: "var(--text-muted)" }} />
            Runtime
          </span>
          {data.system === null ? (
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              System status unavailable
            </span>
          ) : (
            <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              {(
                [
                  { label: "Database", ok: data.system.environment.hasDatabase },
                  { label: "Redis", ok: data.system.environment.hasRedis },
                  { label: "Encryption", ok: data.system.environment.hasEncryptionKey },
                  { label: "LLM gateway", ok: data.system.environment.hasLlmEndpoint },
                ] as const
              ).map((svc) => (
                <span
                  key={svc.label}
                  className="badge"
                  style={{
                    background: svc.ok ? "var(--ok-light)" : "var(--surface-2)",
                    color: svc.ok ? "var(--ok-strong)" : "var(--text-muted)",
                    border: svc.ok ? undefined : "1px solid var(--border)",
                  }}
                >
                  {svc.label}
                </span>
              ))}
            </div>
          )}
          <Link href="/settings/system" className="section-link" style={{ marginLeft: "auto" }}>
            System settings
            <Icon name="arrowRight" size={13} />
          </Link>
        </div>
        <div
          style={{ textAlign: "center", marginTop: 18, fontSize: 11.5, color: "var(--text-muted)" }}
        >
          AgentFlow v{data.system?.version ?? "0.1.0"} · Self-hosted · Your data stays on your
          server
        </div>
      </div>
    </div>
  );
}
