# Hono — knowledge for `apps/api`

AgentFlow's API is a **Hono** app running on **Node** (not edge). One runtime
across all services is a decided constraint — the worker runs the same
TypeScript, the same Zod schemas, the same DB access.

## Why Hono here

- Tiny, fast, framework-agnostic (it's a `Request`/`Response` handler chain).
- Runs on Node via `@hono/node-server` — no edge-only APIs, no surprise
  runtime divergence between dev, worker, and container.
- Middleware ecosystem is small but sufficient: `hono/jwt`, `hono/logger`
  (or the redacting logger — see `11-security-credentials.md`).

## What the API serves

| Area | Path | Notes |
| --- | --- | --- |
| REST for the UI | `/api/...` | flows CRUD, publish, runs, credentials refs, channel status |
| Channel webhooks | `/webhooks/messenger`, `/webhooks/instagram`, `/webhooks/whatsapp`, `/webhooks/tiktok` | verify → dedupe → enqueue → 200, <100ms |
| Widget | `/widget` (SSE), `/widget/messages` | our own channel, no reply window |

## Webhook handler pattern (hard invariant §4.2)

Every channel webhook follows the same shape — the handler does **nothing
else**:

1. **Verify signature** — HMAC over the raw body with the channel app secret
   (Meta: `X-Hub-Signature-256`; TikTok: check current docs). Read the **raw
   body** before any JSON parsing.
2. **Dedupe** — unique index on `(channel, external_message_id)`;
   `INSERT ... ON CONFLICT DO NOTHING` (or check-then-insert with the index as
   the backstop, assuming any handler runs twice).
3. **Enqueue** — push a BullMQ job to the worker (see `07-bullmq-redis.md`).
4. **Return 200** — fast. Meta silently disables webhook subscriptions after
   repeated slow/failed deliveries. Keep the whole path under 100ms.

No LLM calls, no DB writes beyond the dedupe insert, no outbound sends in the
webhook handler. Everything happens in the worker.

## Routing and structure

- Group routes per domain (`flows`, `runs`, `channels`, `credentials`).
- Zod-validate every boundary: query params, body, path params, and env vars
  (`08-zod-validation.md`). Return typed errors from
  `packages/shared/src/errors.ts` — never throw strings, never empty catches.
- Named exports only.

## SSE for the widget

- Widget messages stream over SSE (`text/event-stream`). Keep the connection
  open per conversation; publish events from the worker via Redis pub/sub so
  any API instance can fan out to its connected clients.

## Gotchas

- **`@hono/node-server`** serves the app; compose it as a plain request
  handler so Caddy can reverse-proxy `/api`, `/webhooks`, `/widget` to one
  port.
- **Raw body for verification**: Hono parses JSON lazily — use
  `c.req.raw.text()` (or the raw request) for HMAC verification *before*
  `c.req.json()`.
- **Timeouts**: the Node server default keeps connections open; set sensible
  request timeouts so a stuck webhook never trips Meta's latency detection.
- **Never log message bodies** — the redacting logger from `packages/shared`
  is the only logger. No raw `console.log` in `api` or `worker`.
- **No `any`** — strict TypeScript. Webhook payloads are untrusted; validate
  with Zod and normalize into `NormalizedMessage` via the channel adapters
  (`09-meta-channels.md`).

## Useful links

- Hono docs: <https://hono.dev>
- Hono Node server: <https://hono.dev/docs/getting-started/nodejs>
