# TikTok + Web Widget channels

## TikTok Business Messaging API

TikTok's **Business Messaging API** (part of TikTok API for Business) lets
businesses receive and reply to DMs from the TikTok app. Integrates with
TikTok for Business accounts; API use is free (per TikTok's developer portal).

### What to verify before coding (this drifts — AGENTS.md §13)

- **Reply window duration.** Do not trust a stale constant. Third-party
  integrations (e.g., Chatwoot) document a **48-hour reply window** from the
  customer's last message, but TikTok's own docs are the source of truth —
  check <https://business-api.tiktok.com/portal/docs> (Business Messaging API
  section) at implementation time and record the confirmed duration with a
  doc link next to the constant in `packages/channels/src/windows.ts`.
- **Webhook signature scheme** — TikTok signs webhook payloads; confirm the
  exact header and HMAC construction in the current docs before writing the
  verification code.
- **Partner approval / app review** — sending messages may require TikTok
  approval; the channel setup UI must surface approval status in plain
  English, same as Meta (AGENTS.md §7).

### Implementation notes

- Same adapter contract: normalize inbound → `NormalizedMessage`; send
  outbound from `NormalizedReply` with an idempotency key (invariant §4.3).
- The engine never branches on channel type — TikTok-specific logic (window
  check, API shapes) lives in the adapter.
- Webhook handler: verify → dedupe on TikTok's message id → enqueue → 200,
  <100ms (invariant §4.2).
- Window closed → route to human inbox (or whatever the operator configured) —
  never attempt-and-swallow (invariant §4.4).

## Web Widget (our SSE channel)

The widget is our own channel — no provider, no reply window (the customer is
on our site, so freeform messaging is unrestricted).

### How it works

- **Embeddable script** on the operator's site opens a chat bubble; it talks
  to the AgentFlow API over our endpoint.
- **Inbound**: widget → `POST /widget/messages` (or SSE send) → API verifies
  the widget's token/workspace → dedupe → enqueue → 200.
- **Outbound**: worker → API publishes the reply → SSE stream to the
  connected widget client for that conversation (Redis pub/sub fan-out so any
  API instance can reach any client).
- `canSendFreeform` always returns true for the widget; the constant and the
  doc link still live in `windows.ts` so the rule is uniform.

### Widget safety

- The widget is still a boundary: validate payloads with Zod, never trust the
  embed (a visitor can forge messages) — it's a customer message, same
  untrusted-input rules as every channel (invariant §4.5).
- Auth: workspace-scoped token per embed; the API must not leak other
  conversations via guessed conversation ids.

## Testing

- TikTok: captured real-payload fixtures; valid/invalid signature; duplicate
  delivery; window-boundary cases.
- Widget: SSE connect/disconnect, reconnection, concurrent conversations on
  one API instance, forge attempts rejected.
- Scrub all fixture payloads — never commit real customer data (AGENTS.md §12).

## Useful links

- TikTok API for Business docs (portal; verify reply window + webhook auth):
  <https://business-api.tiktok.com/portal/docs>
- TikTok Business Messaging education hub:
  <https://business-api.tiktok.com/portal/bm-api/education-hub>
