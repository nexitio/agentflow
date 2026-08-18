/**
 * `pnpm eval` — run the graded eval cases against a real LLM and print the
 * verdicts. Run it before and after any prompt / retrieval / tool-schema
 * change and compare the deltas (AGENTS.md §10 — never ship a prompt change
 * on vibes).
 *
 * Env: LLM_BASE_URL, LLM_API_KEY (required), EMBEDDING_MODEL, DATABASE_URL
 * (required for knowledge cases). EVAL_MODEL overrides the model sub-node.
 * Exits 1 when any case fails; 0 when everything passes or infra is missing
 * (a skipped eval is a signal to configure infra, not a green check).
 */

import { loadEnv } from "@agentflow/shared/env";
import { z } from "zod";

import { runEvals } from "./runner";

const evalEnvSchema = z.object({
  LLM_BASE_URL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  EVAL_MODEL: z.string().min(1).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

async function main(): Promise<void> {
  const env = loadEnv(evalEnvSchema);
  const summary = await runEvals({
    llm: {
      baseUrl: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      embeddingModel: env.EMBEDDING_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
    },
  });

  console.log(`\n${"─".repeat(72)}`);
  console.log("EVAL RESULTS");
  console.log(`${"─".repeat(72)}`);
  for (const result of summary.results) {
    const mark = result.verdict === "pass" ? "✓" : result.verdict === "fail" ? "✗" : "–";
    console.log(`${mark} [${result.vertical}] ${result.name} (${result.durationMs}ms)`);
    for (const note of result.notes) {
      console.log(`    · ${note}`);
    }
    if (result.toolCalls.length > 0) {
      console.log(`    tools called: ${result.toolCalls.join(", ")}`);
    }
  }
  console.log(`${"─".repeat(72)}`);
  console.log(`passed: ${summary.passed}  failed: ${summary.failed}  skipped: ${summary.skipped}`);

  if (summary.failed > 0) {
    console.log("\nSome cases failed — investigate before shipping prompt/tool changes.");
    process.exitCode = 1;
  } else if (summary.skipped > 0) {
    console.log(
      "\nSkipped cases need EMBEDDING_MODEL / DATABASE_URL — set them for full coverage.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
