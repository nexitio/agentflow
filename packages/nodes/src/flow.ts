/**
 * The workflow JSON — a public contract (AGENTS.md §4.1).
 *
 * Saved flows are the operator's data and our export/import and template
 * format. Every node carries `typeVersion`; old versions keep executing
 * forever via per-node migrations. Changing this shape requires a migration —
 * the engine must load and run a flow exported six months ago.
 *
 * Nodes live in a flat list; an agent node references its attached sub-nodes
 * (Model, Memory, Knowledge, Tool) by id via `subNodeIds`. Sub-nodes do not
 * sit in the main sequence — main-sequence edges describe what happens after
 * the agent finishes, not how it thinks.
 */

import { ValidationError } from "@agentflow/shared/errors";
import { z } from "zod";

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  typeVersion: z.number().int().positive(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Attached sub-nodes (agent family only). */
  subNodeIds: z.array(z.string()).optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowDocumentSchema = z.object({
  version: z.literal(1),
  // Drafts may be empty while the operator is building; execution enforces
  // exactly one trigger node (engine), never the schema.
  nodes: z.array(flowNodeSchema).default([]),
  edges: z.array(flowEdgeSchema).default([]),
});
export type FlowDocument = z.infer<typeof flowDocumentSchema>;

export function parseFlow(json: unknown): FlowDocument {
  const parsed = flowDocumentSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ValidationError(`Flow JSON is invalid — ${problems}`, {
      details: { problems },
    });
  }
  return parsed.data;
}
