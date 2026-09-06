"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useTheme } from "../../lib/theme";
import { Icon, type IconName } from "./icons";

export interface DashboardUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/flows", label: "Agents", icon: "bot" },
  { href: "/channels", label: "Channels", icon: "radio" },
];

const MANAGE_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/settings/workspace", label: "Workspace", icon: "building" },
  { href: "/settings/appearance", label: "Appearance", icon: "palette" },
  { href: "/settings/knowledge", label: "Knowledge Base", icon: "book" },
  { href: "/settings/security", label: "Security", icon: "shield" },
  { href: "/settings/api-keys", label: "API Keys", icon: "key" },
  { href: "/settings/audit", label: "Audit Log", icon: "list" },
  { href: "/settings/system", label: "System", icon: "server" },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/flows": "Agents",
  "/channels": "Channels",
  "/settings": "Settings",
  "/settings/workspace": "Workspace",
  "/settings/appearance": "Appearance",
  "/settings/knowledge": "Knowledge Base",
  "/settings/security": "Security",
  "/settings/api-keys": "API Keys",
  "/settings/audit": "Audit Log",
  "/settings/system": "System",
  "/settings/agents": "Agents",
  "/settings/channels": "Channel Credentials",
};

const RAIL_KEY = "agentflow-rail-collapsed";

interface EnvHealth {
  hasEncryptionKey: boolean;
  hasDatabase: boolean;
  hasRedis: boolean;
  hasLlmEndpoint: boolean;
}

export function DashboardShell({
  user,
  children,
}: {
  user: DashboardUser | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [env, setEnv] = useState<EnvHealth | null>(null);

  // The canvas wants every pixel; run it flush under the rail.
  const immersive = /^\/flows\/[^/]+$/.test(pathname);

  useEffect(() => {
    const stored = window.localStorage.getItem(RAIL_KEY);
    if (stored === "collapsed") {
      setCollapsed(true);
    }
  }, []);

  // Session watchdog + live service count for the topbar status chip.
  useEffect(() => {
    let cancelled = false;
    async function loadSystem() {
      try {
        const res = await fetch("/api/settings/system", { credentials: "same-origin" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const body = (await res.json()) as { environment: EnvHealth };
          if (!cancelled) {
            setEnv(body.environment);
          }
        }
      } catch {
        // API unreachable — leave the chip hidden, keep browsing shell.
      }
    }
    void loadSystem();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const toggleRail = useCallback(() => {
    // Below the mobile breakpoint the rail is an overlay drawer — toggle that
    // instead of the desktop collapse state (the canvas pages hide the topbar).
    if (window.matchMedia("(max-width: 880px)").matches) {
      setMobileOpen((current) => !current);
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(RAIL_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const isActive = useCallback(
    (href: string): boolean => {
      if (href === "/") return pathname === "/";
      if (href === "/flows") {
        return pathname === "/flows" || pathname.startsWith("/flows/");
      }
      if (href === "/settings") return pathname === "/settings";
      return pathname.startsWith(href);
    },
    [pathname],
  );

  const initials = useMemo(() => {
    const name = user?.name?.trim();
    if (name === undefined || name === null || name === "") {
      return "AF";
    }
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, [user]);

  const envReady = useMemo(() => {
    if (env === null) return null;
    const entries = [env.hasDatabase, env.hasRedis, env.hasEncryptionKey, env.hasLlmEndpoint];
    return { ready: entries.filter(Boolean).length, total: entries.length };
  }, [env]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  const renderNavGroup = useCallback(
    (items: NavItem[]) => {
      return items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={closeMobile}
            className={`dash-nav-link${active ? " active" : ""}`}
            title={collapsed ? item.label : undefined}
          >
            <span className="dash-nav-icon">
              <Icon name={item.icon} size={19} />
            </span>
            <span className="dash-nav-label">{item.label}</span>
          </Link>
        );
      });
    },
    [closeMobile, collapsed, isActive],
  );

  // Breadcrumb trail: group root + (optional) Settings level + current page.
  // Kept as plain labels — a single page never repeats its own name.
  const crumbs = useMemo(() => {
    const title = PAGE_TITLES[pathname] ?? "Dashboard";
    if (pathname.startsWith("/settings/")) {
      return ["Manage", "Settings", title];
    }
    if (pathname.startsWith("/settings")) {
      return ["Manage", "Settings"];
    }
    if (pathname === "/") {
      return ["Overview"];
    }
    return ["Workspace", title];
  }, [pathname]);

  // Legacy settings sub-pages are single-column forms — keep their line length
  // readable instead of letting every card span the full dashboard width.
  const narrowSettings = pathname.startsWith("/settings/");

  return (
    <div className={`dash-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          type="button"
          className="dash-mobile-backdrop"
          aria-label="Close navigation"
          onClick={closeMobile}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className={`dash-sidebar${mobileOpen ? " open" : ""}`}>
        <div className="dash-brand">
          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: 0 }}
          >
            <span className="dash-logo">A</span>
          </button>
          <div className="dash-brand-text">
            <span className="dash-brand-name">AgentFlow</span>
            <span className="dash-brand-tag">Self-hosted</span>
          </div>
          <button
            type="button"
            className="dash-collapse-btn"
            onClick={toggleRail}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <Icon name="chevronsLeft" size={16} />
          </button>
        </div>

        <nav className="dash-nav">
          <div className="dash-nav-group">
            <div className="dash-nav-group-label">Workspace</div>
            {renderNavGroup(MAIN_NAV)}
          </div>
          <div className="dash-nav-group">
            <div className="dash-nav-group-label">Manage</div>
            {renderNavGroup(MANAGE_NAV)}
          </div>
        </nav>

        <div className="dash-sidebar-footer">
          <div className="dash-theme-switch">
            {(
              [
                { value: "light" as const, icon: "sun" as IconName, label: "Light" },
                { value: "system" as const, icon: "monitor" as IconName, label: "Auto" },
                { value: "dark" as const, icon: "moon" as IconName, label: "Dark" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={theme === option.value ? "active" : ""}
                title={`${option.label} theme`}
              >
                <Icon name={option.icon} size={13} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>

          <div className="dash-user">
            <span className="dash-avatar">{initials}</span>
            <div className="dash-user-meta">
              <div className="dash-user-name">{user?.name ?? "Operator"}</div>
              <div className="dash-user-email">{user?.email ?? "Local preview — API offline"}</div>
            </div>
            {user !== null && (
              <div className="dash-user-actions">
                <button
                  type="button"
                  className="dash-collapse-btn"
                  style={{ marginLeft: 0 }}
                  onClick={() => void handleLogout()}
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <Icon name="logout" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="dash-main">
        {!immersive && (
          <header className="dash-topbar">
            <button
              type="button"
              className="btn-icon dash-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" size={20} />
            </button>
            <nav className="dash-crumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span key={crumb} className="flex items-center" style={{ gap: 8 }}>
                    {index > 0 && <span className="crumb-sep">/</span>}
                    <span className={last ? "crumb-current" : "crumb-root"}>{crumb}</span>
                  </span>
                );
              })}
            </nav>

            <div className="dash-topbar-actions">
              {envReady !== null && (
                <Link
                  href="/settings/system"
                  className={`dash-status-chip${envReady.ready === envReady.total ? "" : " warn"}`}
                  title="View system status"
                >
                  <span
                    className="dot"
                    style={{
                      ["--dot-color" as string]:
                        envReady.ready === envReady.total ? "#10b981" : "#f59e0b",
                    }}
                  />
                  <span className="chip-text">
                    {envReady.ready === envReady.total
                      ? "All services healthy"
                      : `${envReady.ready} of ${envReady.total} services ready`}
                  </span>
                </Link>
              )}
              <button
                type="button"
                className="btn-icon"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
                aria-label="Toggle theme"
              >
                <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} size={18} />
              </button>
            </div>
          </header>
        )}

        <div
          className={immersive ? "dash-content dash-content--flush" : "dash-content"}
          key={immersive ? undefined : pathname}
        >
          {immersive ? (
            children
          ) : (
            <div
              className={`page-enter dash-container${narrowSettings ? " settings-container" : ""}`}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
