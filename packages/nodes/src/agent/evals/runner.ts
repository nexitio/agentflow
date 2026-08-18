/**
 * Eval runner — executes graded conversations against the REAL agent runtime
 * (real LLM via env config, real pgvector retrieval) and grades the outcomes.
 *
 * Tool calls are served by a local mock HTTP server so evals are
 * self-contained. Knowledge chunks are embedded with the configured embedding
 * model, upserted under `eval:<caseId>`, and removed afterwards — the
 * harness never pollutes the operator's knowledge base.
 *
 * Missing infra degrades gracefully: knowledge cases without a database are
 * skipped, never silently weakened.
 */

import type { Server } from "node:http";
import { createServer } from "node:http";
import { createDbClient, type Db } from "@agentflow/db/client";
import { deleteSource, upsertChunks } from "@agentflow/db/repo/knowledge";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { embed } from "@agentflow/shared/llm";
import type { Logger } from "@agentflow/shared/logger";

import type { FlowNode } from "../../flow";
import { agentParamsSchema } from "../definition";
import { agentRuntime } from "../runtime";
import { EVAL_CASES } from "./cases";
import type { EvalResult, EvalSummary, EvalTool } from "./types";

export interface EvalOptions {
  llm: {
    baseUrl: string;
    apiKey: string;
    embeddingModel?: string;
    timeoutMs?: number;
  };
  /** Optional pre-built database. When absent, the runner opens its own. */
  db?: Db;
  workspaceId?: string;
  now?: () => Date;
}

interface PreparedTool extends EvalTool {
  url: string;
}

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

function startToolServer(tools: PreparedTool[]): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = tools.find(
      (tool) => tool.method === request.method && url.pathname === tool.path,
    );
    response.setHeader("content-type", "application/json");
    if (match === undefined) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    response.end(JSON.stringify(match.response));
  });
}

export async function runEvals(options: EvalOptions): Promise<EvalSummary> {
  const workspaceId = options.workspaceId ?? BUILTIN_WORKSPACE_ID;
  const now = options.now ?? (() => new Date());

  // Prepare tool URLs against a single ephemeral port.
  const server = startToolServer([]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const preparedTools: PreparedTool[] = [];
  for (const case_ of EVAL_CASES) {
    for (const tool of case_.tools ?? []) {
      preparedTools.push({ ...tool, url: `http://127.0.0.1:${port}${tool.path}` });
    }
  }
  // Recreate the server with the prepared routes.
  server.close();
  const toolServer = startToolServer(preparedTools);
  await new Promise<void>((resolve) => toolServer.listen(port, "127.0.0.1", resolve));

  // Open the database if the caller didn't provide one.
  let db = options.db;
  let ownedClient: ReturnType<typeof createDbClient> | undefined;
  const databaseUrl = process.env.DATABASE_URL;
  if (db === undefined && databaseUrl !== undefined) {
    ownedClient = createDbClient(databaseUrl);
    db = ownedClient.db;
    await ensureBuiltinWorkspace(db);
  }

  // The runtime only dereferences ctx.db for knowledge sub-nodes, and those
  // cases are skipped above when no database is available.
  const runtimeDb: Db = db ?? ({} as Db);

  const results: EvalResult[] = [];
  try {
    for (const case_ of EVAL_CASES) {
      const startedAt = now();
      const notes: string[] = [];
      const toolCalls: string[] = [];
      let verdict: EvalResult["verdict"] = "pass";

      const needsKnowledge = (case_.knowledge?.length ?? 0) > 0;
      if (needsKnowledge && db === undefined) {
        results.push({
          caseId: case_.id,
          vertical: case_.vertical,
          name: case_.name,
          verdict: "skipped",
          notes: ["No DATABASE_URL — knowledge cases need Postgres."],
          toolCalls: [],
          durationMs: now().getTime() - startedAt.getTime(),
        });
        continue;
      }

      // Ingest knowledge chunks for this case (same model as runtime queries).
      if (case_.knowledge !== undefined && case_.knowledge.length > 0 && db !== undefined) {
        const embeddingModel = options.llm.embeddingModel;
        if (embeddingModel === undefined) {
          results.push({
            caseId: case_.id,
            vertical: case_.vertical,
            name: case_.name,
            verdict: "skipped",
            notes: ["EMBEDDING_MODEL not set — knowledge cases need it."],
            toolCalls: [],
            durationMs: now().getTime() - startedAt.getTime(),
          });
          continue;
        }
        const embedded = await embed({
          baseUrl: options.llm.baseUrl,
          apiKey: options.llm.apiKey,
          model: embeddingModel,
          inputs: case_.knowledge.map((chunk) => chunk.content),
          timeoutMs: options.llm.timeoutMs,
        });
        await upsertChunks(
          db,
          case_.knowledge.map((chunk, index) => ({
            workspaceId,
            sourceId: `eval:${case_.id}`,
            title: chunk.title,
            content: chunk.content,
            embedding: embedded.vectors[index] ?? [],
          })),
        );
      }

      // Build the flow nodes exactly as the canvas would.
      const subNodes: FlowNode[] = [
        {
          id: "model",
          type: "agent-model",
          typeVersion: 2,
          position: { x: 0, y: 0 },
          params: {
            model: process.env.EVAL_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            responseFormat: case_.responseFormat ?? "text",
            responseSchema: case_.responseSchema ?? "",
          },
        },
      ];
      if (case_.knowledge !== undefined && case_.knowledge.length > 0) {
        subNodes.push({
          id: "knowledge",
          type: "agent-knowledge",
          typeVersion: 2,
          position: { x: 0, y: 0 },
          params: {
            collection: `eval:${case_.id}`,
            maxChunks: 4,
            minSimilarity: 0.2,
            embeddingModel: options.llm.embeddingModel ?? "",
          },
        });
      }
      for (const tool of case_.tools ?? []) {
        const prepared = preparedTools.find((candidate) => candidate.name === tool.name);
        subNodes.push({
          id: `tool-${tool.name}`,
          type: "agent-tool-http",
          typeVersion: 1,
          position: { x: 0, y: 0 },
          params: {
            name: tool.name,
            description: tool.description,
            method: tool.method,
            url: prepared?.url ?? "",
            requireApproval: tool.requireApproval ?? false,
          },
        });
      }

      const outcome = await agentRuntime.execute(
        {
          runId: `eval:${case_.id}`,
          workspaceId,
          channel: "widget",
          input: { text: case_.query, history: case_.history ?? [] },
          inputs: {},
          subNodes,
          db: runtimeDb,
          logger: noopLogger,
          now,
        },
        agentParamsSchema.parse({ systemPrompt: case_.systemPrompt }),
      );

      // Grade.
      if (outcome.type === "error") {
        verdict = "fail";
        notes.push(`Agent returned an error: ${outcome.code} — ${outcome.message}`);
      } else {
        const output = outcome.output as { content?: unknown; toolCalls?: unknown };
        const content = typeof output.content === "string" ? output.content.toLowerCase() : "";
        const executed = Array.isArray(output.toolCalls)
          ? output.toolCalls.filter((name): name is string => typeof name === "string")
          : [];
        toolCalls.push(...executed);

        for (const needle of case_.expect.mustInclude ?? []) {
          if (!content.includes(needle.toLowerCase())) {
            verdict = "fail";
            notes.push(`expected content to include "${needle}"`);
          }
        }
        for (const needle of case_.expect.mustNotInclude ?? []) {
          if (content.includes(needle.toLowerCase())) {
            verdict = "fail";
            notes.push(`expected content NOT to include "${needle}"`);
          }
        }
        if (
          case_.expect.mustCallTool !== undefined &&
          !executed.includes(case_.expect.mustCallTool)
        ) {
          verdict = "fail";
          notes.push(
            `expected the agent to call "${case_.expect.mustCallTool}" (called: ${executed.join(", ") || "none"})`,
          );
        }
        if (
          case_.expect.mustNotCallTool !== undefined &&
          executed.includes(case_.expect.mustNotCallTool)
        ) {
          verdict = "fail";
          notes.push(`expected the agent NOT to call "${case_.expect.mustNotCallTool}"`);
        }
        if (verdict === "pass") {
          notes.push(`content: ${String(output.content).slice(0, 160)}`);
        }
      }

      // Clean up this case's chunks.
      if (db !== undefined) {
        await deleteSource(db, workspaceId, `eval:${case_.id}`);
      }

      results.push({
        caseId: case_.id,
        vertical: case_.vertical,
        name: case_.name,
        verdict,
        notes,
        toolCalls,
        durationMs: now().getTime() - startedAt.getTime(),
      });
    }
  } finally {
    toolServer.close();
    await ownedClient?.client.end();
  }

  const passed = results.filter((result) => result.verdict === "pass").length;
  const failed = results.filter((result) => result.verdict === "fail").length;
  const skipped = results.filter((result) => result.verdict === "skipped").length;
  return { results, passed, failed, skipped };
}
