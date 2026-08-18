"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ThemeProvider, useTheme } from "../../lib/theme";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  passkeyEnabled: boolean;
}

const NAV_SECTIONS = [
  {
    label: "General",
    items: [
      { href: "/settings", label: "Overview", icon: "grid" },
      { href: "/settings/workspace", label: "Workspace", icon: "building" },
      { href: "/settings/appearance", label: "Appearance", icon: "palette" },
    ],
  },
  {
    label: "AI Agents",
    items: [
      { href: "/settings/agents", label: "Agents", icon: "bot" },
      { href: "/settings/knowledge", label: "Knowledge Base", icon: "book" },
      { href: "/settings/channels", label: "Channels", icon: "radio" },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/settings/security", label: "Security", icon: "shield" },
      { href: "/settings/api-keys", label: "API Keys", icon: "key" },
      { href: "/settings/audit", label: "Audit Log", icon: "list" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings/system", label: "System", icon: "server" },
    ],
  },
];

function NavIcon({ icon }: { icon: string }) {
  const icons: Record<string, React.ReactElement> = {
    grid: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    building: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M9 22V12h6v10M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01" />
      </svg>
    ),
    palette: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="2" />
        <circle cx="17.5" cy="10.5" r="2" />
        <circle cx="8.5" cy="7.5" r="2" />
        <circle cx="6.5" cy="12" r="2" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.03 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-9.94-10-9.94Z" />
      </svg>
    ),
    bot: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </svg>
    ),
    book: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      </svg>
    ),
    radio: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
        <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
        <circle cx="12" cy="12" r="2" />
        <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
        <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
      </svg>
    ),
    shield: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      </svg>
    ),
    key: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
        <path d="m21 2-9.6 9.6" />
        <circle cx="7.5" cy="15.5" r="5.5" />
      </svg>
    ),
    list: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
    server: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <circle cx="6" cy="6" r="1" />
        <circle cx="6" cy="18" r="1" />
      </svg>
    ),
  };
  return icons[icon] ?? null;
}

function SettingsLayoutInner({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = (await res.json()) as { user: User };
        setUser(data.user);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    }
    void checkAuth();
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  if (loading) {
    return (
      <div className="settings-layout">
        <div className="settings-main" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="spinner spinner-lg" />
        </div>
      </div>
    );
  }

  if (user === null) {
    return null;
  }

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function isActive(href: string): boolean {
    if (href === "/settings") return pathname === "/settings";
    return pathname.startsWith(href);
  }

  return (
    <div className="settings-layout">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 35,
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">A</div>
          <div>
            <div className="sidebar-title">AgentFlow</div>
            <div className="sidebar-subtitle">Settings</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="sidebar-section">
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link ${isActive(item.href) ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="sidebar-link-icon">
                    <NavIcon icon={item.icon} />
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Theme toggle */}
          <div style={{ display: "flex", gap: "4px", padding: "0 8px 8px" }}>
            {([
              { value: "light" as const, icon: "☀️", label: "Light" },
              { value: "system" as const, icon: "💻", label: "System" },
              { value: "dark" as const, icon: "🌙", label: "Dark" },
            ]).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                title={option.label}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: "6px",
                  fontSize: "12px",
                  background: theme === option.value ? "rgba(255,255,255,0.15)" : "transparent",
                  color: theme === option.value ? "#fff" : "rgba(255,255,255,0.45)",
                  border: theme === option.value ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <span style={{ fontSize: "13px" }}>{option.icon}</span>
                <span style={{ fontSize: "11px", fontWeight: 500 }}>{option.label}</span>
              </button>
            ))}
          </div>

          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-email">{user.email}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="settings-main">
        <header className="settings-header">
          <div className="flex items-center gap-3">
            <button
              className="btn-icon mobile-menu-btn"
              style={{ display: "none" }}
              onClick={() => setMobileMenuOpen(true)}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <Link href="/flows" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              ← Back to Canvas
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-accent" style={{ textTransform: "capitalize" }}>
              {user.role}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout} type="button">
              Sign out
            </button>
          </div>
        </header>

        <div className="settings-content">{children}</div>
      </main>

      <style>{`
        @media (max-width: 768px) {
          .mobile-menu-btn { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SettingsLayoutInner>{children}</SettingsLayoutInner>
    </ThemeProvider>
  );
}
