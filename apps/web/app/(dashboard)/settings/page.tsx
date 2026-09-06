import Link from "next/link";

import { Icon, type IconName } from "../../../components/dashboard/icons";

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  icon: IconName;
  accent: string;
}> = [
  {
    href: "/settings/workspace",
    title: "Workspace",
    description: "Name, description and general workspace settings",
    icon: "building",
    accent: "var(--accent)",
  },
  {
    href: "/settings/appearance",
    title: "Appearance",
    description: "Theme, accent color and chat widget branding",
    icon: "palette",
    accent: "#ec4899",
  },
  {
    href: "/settings/knowledge",
    title: "Knowledge Base",
    description: "Documents your agents use to answer customers",
    icon: "book",
    accent: "var(--warn)",
  },
  {
    href: "/settings/security",
    title: "Security",
    description: "Two-factor authentication, passkeys and sessions",
    icon: "shield",
    accent: "var(--ok)",
  },
  {
    href: "/settings/api-keys",
    title: "API Keys",
    description: "Scoped tokens for programmatic access",
    icon: "key",
    accent: "var(--info)",
  },
  {
    href: "/settings/audit",
    title: "Audit Log",
    description: "A record of every sensitive action in the workspace",
    icon: "list",
    accent: "var(--text-secondary)",
  },
  {
    href: "/settings/system",
    title: "System",
    description: "Environment, LLM endpoint and runtime health",
    icon: "server",
    accent: "var(--accent)",
  },
  {
    href: "/settings/agents",
    title: "Agents",
    description: "Rename, duplicate and remove your agents",
    icon: "bot",
    accent: "#8b5cf6",
  },
  {
    href: "/settings/channels",
    title: "Channel credentials",
    description: "Tokens and credentials for each messaging channel",
    icon: "radio",
    accent: "#e1306c",
  },
];

export default function SettingsOverviewPage() {
  return (
    <div>
      <div style={{ marginBottom: 26 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Settings
        </h1>
        <p className="page-subtitle">
          Manage your workspace, agents, channels and platform configuration.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}
      >
        {SECTIONS.map((section, index) => (
          <Link
            key={section.href}
            href={section.href}
            className="card-link"
            style={{
              padding: "18px 20px",
              animation: `riseIn 450ms var(--ease-spring) both`,
              animationDelay: `${index * 45}ms`,
            }}
          >
            <div className="flex items-center" style={{ gap: 13 }}>
              <div
                className="tile-icon"
                style={{
                  background: `color-mix(in srgb, ${section.accent} 12%, transparent)`,
                  color: section.accent,
                }}
              >
                <Icon name={section.icon} size={20} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 680, fontSize: 14.5, color: "var(--text)" }}>
                  {section.title}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                  {section.description}
                </div>
              </div>
              <Icon name="chevronsRight" size={15} style={{ color: "var(--text-muted)" }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
