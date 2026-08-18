/**
 * Node definition registry — UI/engine side of the node system. `web` imports
 * only definitions; `worker` imports only runtimes. This is a lookup table,
 * not a barrel.
 */

import { actionLogDefinition } from "../action-log/definition";
import { actionLogMigrations } from "../action-log/migrations";
import { actionSendReplyDefinition } from "../action-send-reply/definition";
import { actionSendReplyMigrations } from "../action-send-reply/migrations";
import { agentDefinition } from "../agent/definition";
import { agentMigrations } from "../agent/migrations";
import {
  agentKnowledgeMigrations,
  agentModelMigrations,
  agentSubNodeMigrations,
} from "../agent/sub-node-migrations";
import {
  agentKnowledgeDefinition,
  agentMemoryDefinition,
  agentModelDefinition,
  agentToolHttpDefinition,
} from "../agent/sub-nodes";
import { logicConditionDefinition } from "../logic-condition/definition";
import { logicConditionMigrations } from "../logic-condition/migrations";
import { triggerChannelDefinition } from "../trigger-channel/definition";
import { triggerChannelMigrations } from "../trigger-channel/migrations";
import { triggerManualDefinition } from "../trigger-manual/definition";
import { triggerManualMigrations } from "../trigger-manual/migrations";
import type { NodeDefinition, NodeMigrations } from "../types";

const definitions: NodeDefinition[] = [
  triggerManualDefinition,
  triggerChannelDefinition,
  agentDefinition,
  agentModelDefinition,
  agentMemoryDefinition,
  agentKnowledgeDefinition,
  agentToolHttpDefinition,
  logicConditionDefinition,
  actionLogDefinition,
  actionSendReplyDefinition,
];

const byType = new Map<string, NodeDefinition>(definitions.map((d) => [d.type, d]));

const migrationsByType = new Map<string, NodeMigrations>([
  ["trigger-manual", triggerManualMigrations],
  ["trigger-channel", triggerChannelMigrations],
  ["agent", agentMigrations],
  ["agent-model", agentModelMigrations],
  ["agent-memory", agentSubNodeMigrations],
  ["agent-knowledge", agentKnowledgeMigrations],
  ["agent-tool-http", agentSubNodeMigrations],
  ["logic-condition", logicConditionMigrations],
  ["action-log", actionLogMigrations],
  ["action-send-reply", actionSendReplyMigrations],
]);

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type);
}

export function getNodeDefinitions(): NodeDefinition[] {
  return definitions;
}

export function getNodeMigrations(type: string): NodeMigrations {
  return migrationsByType.get(type) ?? {};
}
