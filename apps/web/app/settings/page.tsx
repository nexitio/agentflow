"use client";

import Link from "next/link";
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

interface Agent {
  flowId: string;
  name: string;
  publishedVersion: number | null;
  runCount: number;
}

export default function SettingsOverviewPage() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [sysRes, agentsRes] = await Promise.all([
          fetch("/api/settings/system", { credentials: "same-origin" }),
          fetch("/api/settings/agents", { credentials: "same-origin" }),
        ]);
        if (sysRes.ok) setSystem((await sysRes.json()) as SystemInfo);
        if (agentsRes.ok) {
          const data = (await agentsRes.json()) as { agents: Agent[] };
          setAgents(data.agents);
        }
      } catch {
        // Settings not available
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  const publishedCount = agents.filter((a) => a.publishedVersion !== null).length;
  const totalRuns = agents.reduce((sum, a) => sum + a.runCount, 0);

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>Settings</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Manage your workspace, agents, and platform configuration.
      </p>

      {/* Quick Stats */}
      <div className="settings-section">
        <div className="settings-section-title">Overview</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          {[
            {
              label: "Total Agents",
              value: agents.length,
              icon: "🤖",
              href: "/settings/agents",
              color: "var(--accent)",
              bg: "var(--accent-light)",
            },
            {
              label: "Published",
              value: publishedCount,
              icon: "🚀",
              href: "/settings/agents",
              color: "var(--ok)",
              bg: "var(--ok-light)",
            },
            {
              label: "Total Runs",
              value: totalRuns,
              icon: "⚡",
              href: "/settings/audit",
              color: "var(--warn)",
              bg: "var(--warn-light)",
            },
            {
              label: "Workspace",
              value: system?.workspace.name ?? "—",
              icon: "🏢",
              href: "/settings/workspace",
              color: "var(--info)",
              bg: "var(--info-light)",
            },
          ].map((stat) => (
            <Link key={stat.label} href={stat.href} style={{ textDecoration: "none" }}>
              <div
                className="card"
                style={{
                  padding: "20px",
                  transition: "all var(--transition-base)",
                  cursor: "pointer",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: stat.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "18px",
                    }}
                  >
                    {stat.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
                      {stat.label}
                    </div>
                    <div
                      style={{
                        fontSize: "20px",
                        fontWeight: 700,
                        color: stat.color,
                        lineHeight: 1.2,
                      }}
                    >
                      {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* System Health */}
      <div className="settings-section">
        <div className="settings-section-title">System Health</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Platform Status</div>
              <div className="card-description">Verify all services are running correctly</div>
            </div>
            <span className="badge badge-ok">Operational</span>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gap: "12px" }}>
              {[
                {
                  label: "Database",
                  connected: system?.environment.hasDatabase ?? false,
                  description: "PostgreSQL with pgvector",
                },
                {
                  label: "Cache & Queue",
                  connected: system?.environment.hasRedis ?? false,
                  description: "Redis for BullMQ queues",
                },
                {
                  label: "Encryption",
                  connected: system?.environment.hasEncryptionKey ?? false,
                  description: "AES-256-GCM credential encryption",
                },
                {
                  label: "LLM Gateway",
                  connected: system?.environment.hasLlmEndpoint ?? false,
                  description: "OmniRoute or custom endpoint",
                },
              ].map((service) => (
                <div
                  key={service.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border-light)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: service.connected ? "var(--ok)" : "var(--err)",
                        boxShadow: service.connected
                          ? "0 0 6px rgb(16 185 129 / 0.4)"
                          : "0 0 6px rgb(239 68 68 / 0.4)",
                      }}
                    />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 500 }}>{service.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {service.description}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${service.connected ? "badge-ok" : "badge-err"}`}>
                    {service.connected ? "Connected" : "Not configured"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="settings-section">
        <div className="settings-section-title">Quick Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
          {[
            {
              title: "Connect a Channel",
              description: "Set up Messenger, WhatsApp, Instagram, or TikTok",
              href: "/settings/channels",
              icon: "📡",
            },
            {
              title: "Secure Your Account",
              description: "Enable two-factor authentication or passkeys",
              href: "/settings/security",
              icon: "🔐",
            },
            {
              title: "Upload Knowledge",
              description: "Add documents for your agents to reference",
              href: "/settings/knowledge",
              icon: "📚",
            },
            {
              title: "System Configuration",
              description: "Manage LLM settings and environment variables",
              href: "/settings/system",
              icon: "⚙️",
            },
          ].map((action) => (
            <Link key={action.title} href={action.href} style={{ textDecoration: "none" }}>
              <div
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "16px 20px",
                  cursor: "pointer",
                  transition: "all var(--transition-base)",
                }}
              >
                <div style={{ fontSize: "24px", flexShrink: 0 }}>{action.icon}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>{action.title}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    {action.description}
                  </div>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginLeft: "auto", flexShrink: 0 }}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Version Info */}
      <div style={{ textAlign: "center", padding: "24px 0 8px", color: "var(--text-muted)", fontSize: "12px" }}>
        AgentFlow v{system?.version ?? "0.1.0"} · Self-hosted · Open Source
      </div>
    </div>
  );
}
