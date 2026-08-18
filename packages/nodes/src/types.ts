/**
 * Node system shared types (AGENTS.md §5).
 *
 * - A node is a pair: a UI-only `NodeDefinition` (canvas reads it) and a
 *   worker-only `NodeRuntime` (engine executes it). A runtime that imports
 *   React has broken the build for a reason.
 * - Every node handles its own errors and returns a typed `NodeOutcome`.
 *   A *thrown* error fails the run — that must be a deliberate choice.
 * - `destructive: true` nodes require explicit operator opt-in on that node
 *   (invariant §4.5); enforcement lands with tool execution in Phase 4.
 */

import type { Db } from "@agentflow/db/client";
import type { ErrorCode } from "@agentflow/shared/errors";
import type { Logger } from "@agentflow/shared/logger";
import type { Channel } from "@agentflow/shared/types";
import type { z } from "zod";

import type { FlowNode } from "./flow";

export type NodeCategory = "trigger" | "agent" | "sub-node" | "action" | "logic";

export interface NodeDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Stable type id, e.g. "logic-condition". Part of the workflow JSON contract. */
  type: string;
  category: NodeCategory;
  /** Current version of this node's params. Old versions keep executing forever. */
  typeVersion: number;
  label: string;
  description: string;
  /** Icon id — the canvas (Phase 3) renders the matching SVG asset. */
  icon: string;
  /** Param schema: the canvas form is generated from this, and the engine validates with it. */
  paramSchema: TSchema;
  /** Fresh defaults per node instance (never share a mutable object). */
  paramDefaults: () => z.infer<TSchema>;
  handles: {
    inputs: string[];
    /** >1 output handle means the node branches and its outcome carries `branch`. */
    outputs: string[];
  };
  /** Destructive actions require explicit operator opt-in on the node. */
  destructive?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Typed node result. `success` continues the run; `error` fails it with the
 * given code and message. Node authors must choose one — a thrown error is a
 * deliberate "fail the run" signal handled by the engine.
 */
export type NodeOutcome =
  | {
      type: "success";
      output: unknown;
      /** Present when the node's definition has multiple output handles. */
      branch?: string;
      tokenUsage?: TokenUsage;
    }
  | {
      type: "error";
      code: ErrorCode;
      message: string;
    };

export interface NodeExecutionContext {
  runId: string;
  workspaceId: string;
  channel: Channel;
  conversationId?: string;
  /** The trigger input of the whole run (e.g. the NormalizedMessage). */
  input: Record<string, unknown>;
  /** Values arriving on this node's input handles from connected predecessors. */
  inputs: Record<string, unknown>;
  /** Sub-nodes attached to this node (agent family). */
  subNodes: FlowNode[];
  /**
   * Database access — knowledge retrieval (Phase 4), message history (Phase
   * 5). The engine wires the operator's Postgres here; runtimes never open
   * their own connections.
   */
  db: Db;
  logger: Logger;
  now: () => Date;
}

export interface NodeRuntime<TSchema extends z.ZodType = z.ZodType> {
  type: string;
  /** The params version this runtime implements (must match the definition). */
  typeVersion: number;
  execute(ctx: NodeExecutionContext, params: z.infer<TSchema>): Promise<NodeOutcome>;
}

/** Migration table: fromVersion -> upgrade function (upgrades to fromVersion + 1). */
export type NodeMigrations = Record<
  number,
  (params: Record<string, unknown>) => Record<string, unknown>
>;
