/**
 * The inbound job's logic — pure (db + adapters injected) so integration
 * tests can drive it end-to-end without a live queue.
 *
 *   1. Dedupe-insert the inbound message (unique index = at-least-once backstop).
 *   2. Load the newest published flow whose trigger is wired to this channel.
 *   3. Run it, persist the run (invariant §4.9).
 *   4. If the flow ends in a Send Reply node, decide the outbound BEFORE any
 *      provider call (canSendFreeform, invariant §4.4): send freeform, or
 *      route to the human inbox — never attempt-and-swallow.
 *   5. Every send carries an idempotency key; a retried job is a no-op.
 */

import { getProviderAdapter } from "@agentflow/channels";
import type { ChannelAdapter, ChannelCredentials } from "@agentflow/channels/types";
import { createWidgetAdapter, type WidgetPublisher } from "@agentflow/channels/widget";
import { canSendFreeform } from "@agentflow/channels/windows";
import type { Db } from "@agentflow/db/client";
import {
  insertInboundMessage,
  insertOutboundMessage,
  routeToHumanInbox,
  upsertConversation,
} from "@agentflow/db/repo/conversations";
import { getLatestPublishedByChannel } from "@agentflow/db/repo/flows";
import { createRun, finishRun } from "@agentflow/db/repo/runs";
import { executeFlow } from "@agentflow/engine";
import { logger } from "@agentflow/shared/logger";
import type { NormalizedMessage } from "@agentflow/shared/types";
import { uuidv7 } from "@agentflow/shared/uuid";

export interface InboundHandlerOptions {
  db: Db;
  credentials?: ChannelCredentials;
  /** Override per-channel adapters (tests inject fakes). */
  adapters?: Record<string, ChannelAdapter>;
  /** Widget outbound delivery — Redis pub/sub in production (tests pass a fake). */
  widgetPublisher?: WidgetPublisher;
}

function isUniqueViolation(error: unknown): boolean {
  // drizzle wraps the driver error (which carries the Postgres code) in
  // `cause`; unwrap a few levels to find the 23505 unique-violation code.
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    const cause = (current as { cause?: unknown } | null)?.cause;
    if (cause === undefined) {
      return false;
    }
    current = cause;
  }
  return false;
}

/** Find the Send Reply node's output in the run result. */
function replyTextFromRun(
  flowJson: { nodes?: Array<{ id: string; type: string }> },
  nodeOutputs: Record<string, { status?: string; output?: unknown }>,
): string | undefined {
  for (const node of flowJson.nodes ?? []) {
    if (node.type !== "action-send-reply") {
      continue;
    }
    const record = nodeOutputs[node.id];
    if (record?.status !== "success") {
      continue;
    }
    const output = record.output as { text?: unknown } | undefined;
    if (typeof output?.text === "string" && output.text.length > 0) {
      return output.text;
    }
  }
  return undefined;
}

export function createInboundHandler(options: InboundHandlerOptions) {
  const { db } = options;
  const widgetAdapter = createWidgetAdapter(
    options.widgetPublisher ?? { publish: async () => undefined },
  );
  const adapterFor = (channel: string): ChannelAdapter =>
    options.adapters?.[channel] ?? getProviderAdapter(channel as never) ?? widgetAdapter;

  return async function handleInbound(message: NormalizedMessage): Promise<void> {
    const log = logger.child({ service: "worker", channel: message.channel });

    const conversation = await upsertConversation(db, {
      workspaceId: message.workspaceId,
      channel: message.channel,
      externalThreadId: message.externalThreadId,
      externalCustomerId: message.sender.id,
      customerName: message.sender.name,
    });

    try {
      await insertInboundMessage(db, {
        workspaceId: message.workspaceId,
        conversationId: conversation.id,
        channel: message.channel,
        externalMessageId: message.externalMessageId,
        sender: message.sender,
        text: message.text,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // At-least-once: a retried delivery is a no-op, never a double-run.
        log.info("duplicate inbound message ignored", { messageId: message.externalMessageId });
        return;
      }
      throw error;
    }

    const snapshot = await getLatestPublishedByChannel(db, message.workspaceId, message.channel);
    if (snapshot === undefined) {
      log.warn("no published flow for channel", { channel: message.channel });
      return;
    }

    const runId = await createRun(db, {
      workspaceId: message.workspaceId,
      flowSnapshotId: snapshot.id,
      conversationId: conversation.id,
      channel: message.channel,
      input: message,
    });

    const result = await executeFlow({
      flow: snapshot.flowJson,
      input: message,
      workspaceId: message.workspaceId,
      channel: message.channel,
      conversationId: conversation.id,
      db,
      runId,
    });

    let outbound: unknown = { decision: "none" };
    if (result.status === "succeeded") {
      const replyText = replyTextFromRun(
        snapshot.flowJson as { nodes?: Array<{ id: string; type: string }> },
        result.nodeOutputs as Record<string, { status?: string; output?: unknown }>,
      );
      if (replyText !== undefined) {
        const decision = canSendFreeform(message.channel, conversation.lastMessageAt);
        switch (decision.action) {
          case "send-freeform": {
            const reply = {
              id: uuidv7(),
              workspaceId: message.workspaceId,
              channel: message.channel,
              externalThreadId: message.externalThreadId,
              idempotencyKey: `run:${runId}:reply`,
              text: replyText,
              attachments: [],
            };
            const sent = await adapterFor(message.channel).sendOutbound(
              options.credentials ?? {},
              reply,
            );
            try {
              await insertOutboundMessage(db, {
                workspaceId: message.workspaceId,
                conversationId: conversation.id,
                channel: message.channel,
                idempotencyKey: reply.idempotencyKey,
                text: replyText,
              });
            } catch (error) {
              if (!isUniqueViolation(error)) {
                throw error;
              }
              // Retried job: the reply was already sent and recorded.
            }
            log.info("reply sent", { runId, providerMessageId: sent.providerMessageId });
            outbound = {
              decision: "sent",
              providerMessageId: sent.providerMessageId,
              text: replyText,
            };
            break;
          }
          case "send-template":
          case "route-to-inbox": {
            // No template management yet — route to the human inbox rather
            // than attempt the send and swallow the error (invariant §4.4).
            await routeToHumanInbox(db, conversation.id);
            outbound = { decision: "route-to-inbox", reason: decision.reason };
            log.warn("reply window closed — routed to human inbox", { runId });
            break;
          }
        }
      }
    } else {
      log.warn("flow run failed — no reply sent", { runId, code: result.error?.code });
    }

    await finishRun(db, runId, {
      status: result.status,
      nodeOutputs: result.nodeOutputs,
      timings: result.timings,
      tokenUsage: result.tokenUsage,
      ...(result.error !== undefined ? { error: result.error } : {}),
      outbound,
      finishedAt: new Date(result.finishedAt),
    });
  };
}
