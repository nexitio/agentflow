/**
 * The flow execution engine (AGENTS.md §2, §5).
 *
 * - Loads the published flow snapshot (workflow JSON is a public contract),
 *   upgrades every node to its current typeVersion via per-node migrations,
 *   then executes the graph from the single trigger node.
 * - Records per-node output, timings, token usage, and errors (invariant
 *   §4.9) so operators can debug their own agents.
 * - Error policy: a node returns a typed error → the run fails with that
 *   code; a node THROWS → the run fails with INTERNAL (or the typed error's
 *   code). Both are deliberate and persisted.
 * - A flow with no trigger (or several) is a caller bug → executeFlow throws.
 */

import type { Db } from "@agentflow/db/client";
import { type FlowDocument, type FlowNode, parseFlow } from "@agentflow/nodes/flow";
import { getNodeDefinition, getNodeMigrations } from "@agentflow/nodes/registry/definitions";
import { getNodeRuntime } from "@agentflow/nodes/registry/runtimes";
import type { NodeOutcome, NodeRuntime, TokenUsage } from "@agentflow/nodes/types";
import { AgentFlowError, ValidationError } from "@agentflow/shared/errors";
import { logger as defaultLogger, type Logger } from "@agentflow/shared/logger";
import type { Channel } from "@agentflow/shared/types";
import { uuidv7 } from "@agentflow/shared/uuid";

export interface ExecuteFlowOptions {
  /** Raw flow JSON (validated at the boundary with Zod). */
  flow: unknown;
  input: Record<string, unknown>;
  workspaceId: string;
  channel: Channel;
  conversationId?: string;
  /**
   * Database access for nodes that need it (knowledge retrieval, history).
   * The agent node fails with CONFIGURATION if this is unavailable.
   */
  db: Db;
  runId?: string;
  logger?: Logger;
  now?: () => Date;
  /** Test hook: override runtimes for a node type. */
  runtimes?: Record<string, NodeRuntime>;
}

export interface NodeExecutionRecord {
  status: "success" | "error";
  output?: unknown;
  branch?: string;
  error?: { code: string; message: string };
}

export interface NodeTiming {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface RunError {
  code: string;
  message: string;
  nodeId?: string;
}

export interface RunResult {
  runId: string;
  status: "succeeded" | "failed";
  input: Record<string, unknown>;
  nodeOutputs: Record<string, NodeExecutionRecord>;
  timings: Record<string, NodeTiming>;
  tokenUsage: TokenUsage;
  error?: RunError;
  startedAt: string;
  finishedAt: string;
}

/** Upgrade one node's params to the current typeVersion (AGENTS.md §4.1). */
export function upgradeNode(node: FlowNode): FlowNode {
  const definition = getNodeDefinition(node.type);
  if (definition === undefined) {
    // Unknown types fail at execution with a clear message.
    return node;
  }
  if (node.typeVersion > definition.typeVersion) {
    throw new ValidationError(
      `Node "${node.type}" version ${node.typeVersion} is newer than this build supports (${definition.typeVersion}).`,
    );
  }
  let params = node.params;
  let version = node.typeVersion;
  const migrations = getNodeMigrations(node.type);
  while (version < definition.typeVersion) {
    const upgrade = migrations[version];
    if (upgrade === undefined) {
      throw new ValidationError(
        `Node "${node.type}" has no migration path from version ${version}.`,
      );
    }
    params = upgrade(params);
    version += 1;
  }
  return { ...node, typeVersion: version, params };
}

function sumUsage(acc: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    promptTokens: acc.promptTokens + usage.promptTokens,
    completionTokens: acc.completionTokens + usage.completionTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
  };
}

export async function executeFlow(options: ExecuteFlowOptions): Promise<RunResult> {
  const flow: FlowDocument = parseFlow(options.flow);
  const runId = options.runId ?? uuidv7();
  const now = options.now ?? (() => new Date());
  const logger = (options.logger ?? defaultLogger).child({ runId, service: "engine" });
  const runtimeFor = (type: string): NodeRuntime | undefined =>
    options.runtimes?.[type] ?? getNodeRuntime(type);

  // Upgrade every node to its current typeVersion before execution.
  const nodes = flow.nodes.map(upgradeNode);

  // Exactly one trigger per flow.
  const triggers = nodes.filter((node) => getNodeDefinition(node.type)?.category === "trigger");
  if (triggers.length !== 1) {
    throw new ValidationError(
      `A flow needs exactly one trigger node — this flow has ${triggers.length}.`,
    );
  }
  const trigger = triggers[0];
  if (trigger === undefined) {
    throw new ValidationError("A flow needs exactly one trigger node.");
  }

  const startedAt = now();
  const nodeOutputs: Record<string, NodeExecutionRecord> = {};
  const timings: Record<string, NodeTiming> = {};
  const outputsByNode: Record<string, unknown> = {};
  let tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let failure: RunError | undefined;

  const visited = new Set<string>();
  const queue: FlowNode[] = [trigger];

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || failure !== undefined) {
      break;
    }
    if (visited.has(node.id)) {
      continue;
    }
    visited.add(node.id);

    const definition = getNodeDefinition(node.type);
    const runtime = runtimeFor(node.type);

    // Sub-nodes are configuration for their agent — never in the sequence.
    if (definition?.category === "sub-node") {
      continue;
    }

    if (definition === undefined || runtime === undefined) {
      failure = {
        code: "CONFIGURATION",
        message: `Unknown node type "${node.type}".`,
        nodeId: node.id,
      };
      nodeOutputs[node.id] = {
        status: "error",
        error: { code: "CONFIGURATION", message: `Unknown node type "${node.type}".` },
      };
      break;
    }

    if (runtime.typeVersion !== definition.typeVersion) {
      failure = {
        code: "CONFIGURATION",
        message: `Node "${node.type}" runtime version mismatch (definition ${definition.typeVersion}, runtime ${runtime.typeVersion}).`,
        nodeId: node.id,
      };
      break;
    }

    const paramsResult = definition.paramSchema.safeParse(node.params);
    if (!paramsResult.success) {
      const problems = paramsResult.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      failure = {
        code: "VALIDATION",
        message: `Node "${node.type}" has invalid params — ${problems}`,
        nodeId: node.id,
      };
      nodeOutputs[node.id] = {
        status: "error",
        error: {
          code: "VALIDATION",
          message: `Node "${node.type}" has invalid params — ${problems}`,
        },
      };
      break;
    }

    // Wire inputs from connected predecessors (target handle → last output).
    const inputs: Record<string, unknown> = {};
    for (const edge of flow.edges) {
      if (edge.target !== node.id) {
        continue;
      }
      const sourceOutput = outputsByNode[edge.source];
      if (sourceOutput !== undefined) {
        inputs[edge.targetHandle ?? "in"] = sourceOutput;
      }
    }

    // Sub-node params are upgraded with the rest of the flow (AGENTS.md §4.1).
    const subNodes = nodes.filter((attached) => node.subNodeIds?.includes(attached.id));

    const nodeStartedAt = now();
    let outcome: NodeOutcome;
    try {
      outcome = await runtime.execute(
        {
          runId,
          workspaceId: options.workspaceId,
          channel: options.channel,
          conversationId: options.conversationId,
          input: options.input,
          inputs,
          subNodes,
          db: options.db,
          logger,
          now,
        },
        paramsResult.data,
      );
    } catch (error) {
      // A thrown error fails the run — deliberate only if typed.
      const code = error instanceof AgentFlowError ? error.code : "INTERNAL";
      const message = error instanceof Error ? error.message : "Node threw a non-Error value.";
      failure = { code, message, nodeId: node.id };
      nodeOutputs[node.id] = { status: "error", error: { code, message } };
      timings[node.id] = timing(nodeStartedAt, now());
      break;
    }
    timings[node.id] = timing(nodeStartedAt, now());

    if (outcome.type === "error") {
      failure = { code: outcome.code, message: outcome.message, nodeId: node.id };
      nodeOutputs[node.id] = {
        status: "error",
        error: { code: outcome.code, message: outcome.message },
      };
      break;
    }

    nodeOutputs[node.id] = { status: "success", output: outcome.output, branch: outcome.branch };
    outputsByNode[node.id] = outcome.output;
    if (outcome.tokenUsage !== undefined) {
      tokenUsage = sumUsage(tokenUsage, outcome.tokenUsage);
    }

    // Branching nodes follow only the edge on the matched handle; others fan out.
    const isBranch = definition.handles.outputs.length > 1;
    for (const edge of flow.edges) {
      if (edge.source !== node.id) {
        continue;
      }
      if (isBranch && edge.sourceHandle !== outcome.branch) {
        continue;
      }
      const target = nodes.find((candidate) => candidate.id === edge.target);
      if (target !== undefined) {
        queue.push(target);
      }
    }
  }

  const finishedAt = now();
  return {
    runId,
    status: failure === undefined ? "succeeded" : "failed",
    input: options.input,
    nodeOutputs,
    timings,
    tokenUsage,
    ...(failure !== undefined ? { error: failure } : {}),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

function timing(startedAt: Date, finishedAt: Date): NodeTiming {
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
