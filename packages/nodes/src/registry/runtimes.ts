/**
 * Node runtime registry — worker-only side of the node system. A runtime that
 * imports React has broken the build for a reason (AGENTS.md §5).
 */

import { actionLogRuntime } from "../action-log/runtime";
import { actionSendReplyRuntime } from "../action-send-reply/runtime";
import { agentRuntime } from "../agent/runtime";
import {
  agentKnowledgeRuntime,
  agentMemoryRuntime,
  agentModelRuntime,
  agentToolHttpRuntime,
} from "../agent/sub-node-runtimes";
import { logicConditionRuntime } from "../logic-condition/runtime";
import { triggerChannelRuntime } from "../trigger-channel/runtime";
import { triggerManualRuntime } from "../trigger-manual/runtime";
import type { NodeRuntime } from "../types";

const runtimes: NodeRuntime[] = [
  triggerManualRuntime,
  triggerChannelRuntime,
  agentRuntime,
  agentModelRuntime,
  agentMemoryRuntime,
  agentKnowledgeRuntime,
  agentToolHttpRuntime,
  logicConditionRuntime,
  actionLogRuntime,
  actionSendReplyRuntime,
];

const byType = new Map<string, NodeRuntime>(runtimes.map((r) => [r.type, r]));

export function getNodeRuntime(type: string): NodeRuntime | undefined {
  return byType.get(type);
}
