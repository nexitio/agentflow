/**
 * Environment validation — Zod at the boot boundary (AGENTS.md §3).
 * Fails fast with a plain-English ConfigurationError naming the problem.
 */

import type { z } from "zod";

import { ConfigurationError } from "./errors";

export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ConfigurationError(`Environment is misconfigured — ${problems}`, {
      details: { problems },
    });
  }
  return parsed.data;
}
