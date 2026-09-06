import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { ThemeProvider } from "../lib/theme";

export const metadata: Metadata = {
  title: {
    default: "AgentFlow",
    template: "%s · AgentFlow",
  },
  description: "Self-hosted AI support agent builder",
};

const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("agentflow-theme");var d=t==="dark"?"dark":t==="light"?"light":(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",d);}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static trusted theme bootstrap, no user data */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
