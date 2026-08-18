/**
 * Drizzle schema — encodes the data invariants from AGENTS.md §6.
 *
 * - UUIDv7 ids everywhere (time-sortable, generated client-side).
 * - workspace_id on every table, defaulting to the single built-in workspace.
 * - conversations keyed uniquely on (channel, external_thread_id).
 * - messages dedupe on (channel, external_message_id) — the at-least-once
 *   backstop (invariant §4.3).
 * - flows: editable draft + immutable published snapshots; runs reference the
 *   snapshot id so editing never rewrites run history.
 * - runs persist input, per-node output, timings, token usage, errors, and a
 *   retention deadline for the pruning job (invariant §4.9).
 */

import { CHANNELS } from "@agentflow/shared/types";
import { uuidv7 } from "@agentflow/shared/uuid";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core/columns/vector_extension/vector";

const uuidv7Id = () => uuid("id").primaryKey().$defaultFn(uuidv7);

export const channelEnum = pgEnum("channel", CHANNELS);

export const userRoleEnum = pgEnum("user_role", ["admin", "member", "viewer"]);

export const flowStatusEnum = pgEnum("flow_status", ["draft", "published"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "closed",
  "human_inbox",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

export const runStatusEnum = pgEnum("run_status", ["pending", "running", "succeeded", "failed"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuidv7Id(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workspaces_name_idx").on(table.name)],
);

/**
 * One row per flow version. `flowId` is the stable logical identity; a flow
 * has exactly one `draft` row (partial unique index) and any number of
 * immutable `published` rows. Publish = copy draft into a new published row
 * with the next version. Runs reference a published row's `id`.
 */
export const flows = pgTable(
  "flows",
  {
    id: uuidv7Id(),
    flowId: uuid("flow_id").notNull().$defaultFn(uuidv7),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: flowStatusEnum("status").notNull(),
    version: integer("version").notNull(),
    /** The workflow JSON — a public contract; nodes carry typeVersion. */
    flowJson: jsonb("flow_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("flows_flow_id_version_idx").on(table.flowId, table.version),
    uniqueIndex("flows_draft_one_per_flow_idx")
      .on(table.flowId)
      .where(sql`${table.status} = 'draft'`),
    index("flows_workspace_idx").on(table.workspaceId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    channel: channelEnum("channel").notNull(),
    /** Identity key — cross-channel identity merging depends on this. */
    externalThreadId: text("external_thread_id").notNull(),
    externalCustomerId: text("external_customer_id"),
    customerName: text("customer_name"),
    status: conversationStatusEnum("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_channel_thread_idx").on(table.channel, table.externalThreadId),
    index("conversations_workspace_idx").on(table.workspaceId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    channel: channelEnum("channel").notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    /** Provider message id (inbound). Outbound rows may be null until ack. */
    externalMessageId: text("external_message_id"),
    /** At-least-once guard for outbound sends (invariant §4.3). */
    idempotencyKey: text("idempotency_key"),
    sender: jsonb("sender"),
    text: text("text").notNull().default(""),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_channel_external_id_idx")
      .on(table.channel, table.externalMessageId)
      .where(sql`${table.externalMessageId} IS NOT NULL`),
    uniqueIndex("messages_idempotency_key_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("messages_conversation_idx").on(table.conversationId),
    index("messages_workspace_idx").on(table.workspaceId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** The immutable published snapshot this run executed (invariant §4.9). */
    flowSnapshotId: uuid("flow_snapshot_id")
      .notNull()
      .references(() => flows.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    channel: channelEnum("channel").notNull(),
    /** Trigger input, e.g. the NormalizedMessage. */
    input: jsonb("input").notNull(),
    /** Per-node output keyed by node id. */
    nodeOutputs: jsonb("node_outputs").notNull().default(sql`'{}'::jsonb`),
    /** Per-node timings keyed by node id. */
    timings: jsonb("timings").notNull().default(sql`'{}'::jsonb`),
    tokenUsage: jsonb("token_usage").notNull().default(sql`'{}'::jsonb`),
    status: runStatusEnum("status").notNull().default("pending"),
    /** Typed error shape when the run failed. */
    error: jsonb("error"),
    /**
     * Outbound routing outcome (Phase 5): the window decision + send result.
     * Window closed → send-template / route-to-inbox, never a swallowed send.
     */
    outbound: jsonb("outbound"),
    /** Retention deadline — the pruning job (Phase 7) deletes expired runs. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runs_workspace_idx").on(table.workspaceId),
    index("runs_conversation_idx").on(table.conversationId),
    index("runs_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

/**
 * Knowledge base chunks — retrieved by the agent's knowledge sub-node.
 * Embeddings live in pgvector right beside the relational data; no separate
 * vector database (AGENTS.md §3). The operator's embedding model must match
 * the 1536-dim column (defaults like text-embedding-3-small). Retrieved
 * content is untrusted (§4.5) — delimited and labelled as data in the agent
 * prompt, never tool authority.
 */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Document this chunk came from — the operator's source id. */
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    embedding: vector({ dimensions: 1536 }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_chunks_workspace_idx").on(table.workspaceId),
    // Approximate nearest-neighbor search with cosine distance. The opclass
    // needs raw SQL because pgvector's vector_cosine_ops isn't an enum method.
    index("knowledge_chunks_embedding_hnsw_idx").using(
      "hnsw",
      sql`${table.embedding} vector_cosine_ops`,
    ),
  ],
);

/**
 * Per-channel webhook health for the setup screen (AGENTS.md §7) — what the
 * operator needs to know in plain English: is the webhook verified, are
 * events arriving, and what's the last error. Updated by the webhook routes.
 */
export const channelStatus = pgTable(
  "channel_status",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    channel: channelEnum("channel").notNull(),
    /** The webhook URL we told the operator to paste (shown on the screen). */
    webhookUrl: text("webhook_url"),
    /** Set when the provider's verification handshake succeeded (Meta GET). */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Last time any webhook event arrived on this channel. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    /** Last error in plain English (e.g. "invalid app secret"). */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("channel_status_workspace_channel_idx").on(table.workspaceId, table.channel),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    channel: channelEnum("channel").notNull(),
    /** Operator-facing label, e.g. "WhatsApp — Acme page". */
    name: text("name").notNull(),
    /** AES-256-GCM payload — never returned, even to admins (invariant §4.6). */
    encryptedValue: text("encrypted_value").notNull(),
    /** Display hint only, e.g. "…abcd". */
    maskedHint: text("masked_hint").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credentials_workspace_idx").on(table.workspaceId)],
);

// ─── Auth tables ──────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** Argon2id hash — never stored plaintext (invariant §4.6). */
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("admin"),
    avatarUrl: text("avatar_url"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    passkeyEnabled: boolean("passkey_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_workspace_email_idx").on(table.workspaceId, table.email),
    index("users_workspace_idx").on(table.workspaceId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuidv7Id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Signed JWT stored as opaque session id in the cookie. */
    token: text("token").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_idx").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const totpSecrets = pgTable(
  "totp_secrets",
  {
    id: uuidv7Id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Encrypted TOTP secret — never returned (invariant §4.6). */
    encryptedSecret: text("encrypted_secret").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("totp_secrets_user_idx").on(table.userId),
  ],
);

export const passkeys = pgTable(
  "passkeys",
  {
    id: uuidv7Id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** WebAuthn credential ID — base64url-encoded. */
    credentialId: text("credential_id").notNull(),
    /** The public key stored from registration. */
    publicKey: text("public_key").notNull(),
    /** Counter for replay protection. */
    counter: integer("counter").notNull().default(0),
    /** Device info the user labelled during registration. */
    label: text("label").notNull().default(""),
    /** Transports supported by the authenticator. */
    transports: jsonb("transports").notNull().default(sql`'[]'::jsonb`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("passkeys_credential_id_idx").on(table.credentialId),
    index("passkeys_user_idx").on(table.userId),
  ],
);

export const settings = pgTable(
  "settings",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Dot-notched key, e.g. "workspace.name", "llm.model". */
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("settings_workspace_key_idx").on(table.workspaceId, table.key),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    /** Structured metadata — no PII (invariant §4.7). */
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_workspace_idx").on(table.workspaceId),
    index("audit_log_user_idx").on(table.userId),
    index("audit_log_action_idx").on(table.action),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuidv7Id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Hashed key — the prefix is shown for identification. */
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_idx").on(table.keyHash),
    index("api_keys_workspace_idx").on(table.workspaceId),
  ],
);
