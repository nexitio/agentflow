"use client";

import type { Node } from "@xyflow/react";
import { createContext } from "react";

// Type alias (not interface) so it satisfies React Flow's
// `NodeData extends Record<string, unknown>` constraint via the implicit
// index signature object literals get.
export type CanvasNodeData = {
  params: Record<string, unknown>;
  subNodeIds: string[];
};

export type CanvasNode = Node<CanvasNodeData, string>;

export interface NodeActions {
  addSubNode(agentId: string, type: string): void;
  removeNode(id: string): void;
  updateParams(nodeId: string, params: Record<string, unknown>): void;
  /** nodeId -> type, so the agent tray can label its attached sub-nodes. */
  nodeTypeById: Record<string, string>;
}

export const NodeActionsContext = createContext<NodeActions | null>(null);
