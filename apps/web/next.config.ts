import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Turbopack compile them.
  transpilePackages: ["@agentflow/nodes", "@agentflow/shared"],
};

export default nextConfig;
