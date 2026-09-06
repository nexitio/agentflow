import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell, type DashboardUser } from "../../components/dashboard/shell";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Dashboard layout — every authenticated surface of the product lives under
 * this shell (overview, agents, channels, settings, canvas). The session
 * cookie is forwarded to the API to authorize server-rendered children.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let user: DashboardUser | null = null;

  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (response.status === 401) {
      redirect("/login");
    }
    if (response.ok) {
      const body = (await response.json()) as { user: DashboardUser };
      user = body.user;
    }
  } catch {
    // API unreachable — keep browsing so pages can show their own errors.
    // The shell's client watchdog will route to /login on a real 401.
  }

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
