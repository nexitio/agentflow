import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * One project per workspace package with an explicit ABSOLUTE root, so
 * `vitest run` collects the right tests no matter which directory invokes it
 * (turbo/per-package scripts run from the package's own cwd; project roots
 * would otherwise resolve relative to that cwd).
 */
function project(name: string, root: string) {
  return {
    test: {
      name,
      root: fileURLToPath(new URL(root, import.meta.url)),
      include: ["src/**/*.test.ts"],
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      project("shared", "packages/shared"),
      project("db", "packages/db"),
      project("engine", "packages/engine"),
      project("nodes", "packages/nodes"),
      project("channels", "packages/channels"),
      project("api", "apps/api"),
      project("worker", "apps/worker"),
      project("web", "apps/web"),
    ],
    environment: "node",
    passWithNoTests: true,
    // DB integration tests in different projects share one throwaway database;
    // run files sequentially so TRUNCATEs never clobber a running test.
    fileParallelism: false,
  },
});
