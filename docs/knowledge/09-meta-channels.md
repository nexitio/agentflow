# Meta channels — Messenger, Instagram DM, WhatsApp Cloud API

Messenger, Instagram DM, and WhatsApp all run on the **Meta Graph API**
(current stable version as of early 2026: **v21.0** — pin the version in code
and bump deliberately; Meta deprecates versions on a schedule). Messenger and
Instagram DM are **the same app** with the same webhook surface; WhatsApp is
the Cloud API on the same Graph API.

## Getting the plumbing right

- **Webhooks**: Meta sends `POST` JSON to the configured URL with an
  `X-Hub-Signature-256` header — HMAC-SHA256 of the raw body using the app
  secret. Verify the signature on the **raw body before JSON parsing**
  (invariant §4.2).
- **Verification handshake**: Meta's subscription setup sends a `GET` with
  `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`; echo the
  challenge back after checking the verify token.
- **Delivery**: Meta retries failures and *silently disables* subscriptions
  after repeated slow/failed deliveries → webhook handler = verify → dedupe →
  enqueue → 200 in <100ms, nothing else (invariant §4.2).
- **Dedupe**: inbound messages carry an id (`message.mid` for Messenger/IG,
  `messages[0].id` for WhatsApp). Unique index on
  `(channel, external_message_id)` (invariant §4.3).

## Messenger / Instagram DM

- Same Meta app, same Graph API; Instagram DM is a product on the same app.
- Send via `POST /{ig-id}/messages` or `POST /me/messages` with a page access
  token; `messaging_type` (`RESPONSE`, `UPDATE`, `MESSAGE_TAG`) matters for
  policy compliance.
- **Reply window**: 24h from the customer's last message. Inside the window:
  freeform replies. Outside: the **human agent tag** (`MESSAGE_TAG` with
  `HUMAN_AGENT`) extends the window to **7 days** — that's the
  route-to-human-inbox path (invariant §4.4: window closed → human inbox or
  approved template, never attempt-and-swallow).
- Expect echoes (messages the bot sent, `message.is_echo`) and delivery/read
  receipts in the webhook — filter to actual customer messages before
  enqueuing.

## WhatsApp Cloud API

- Webhook: `messages` object with `from`, `id`, `timestamp`, `type`, and
  `text`/`image`/etc. Phone-number-id webhook fields differ from Messenger —
  normalize in the adapter.
- **Reply window**: 24h customer service window. Outside it, **only approved
  template messages** can be sent (the operator's templates, configured in the
  UI). Window closed → send the approved template or route to the human
  inbox — never attempt the send and swallow the error (invariant §4.4).
- Sending: `POST /{phone-number-id}/messages` with a Bearer token; the API
  returns a message id (used for the outbound idempotency key / status
  tracking).
- **Freeform check**: `canSendFreeform(conversation)` in
  `packages/channels/src/windows.ts` — the single place window durations live
  as named constants with doc links. **Never inline `86400000`.**
- WhatsApp requires business-initiated messages to use templates; message
  status webhooks (`sent`/`delivered`/`read`/`failed`) help the run inspector.

## Adapter contract (AGENTS.md §7)

The engine never branches on channel type:

- Inbound: normalize any Meta payload → `NormalizedMessage`
  (channel, external_thread_id, external_message_id, sender, text, attachments,
  timestamp).
- Outbound: `NormalizedReply` → provider call (with idempotency key).
- Reply-window constants and `canSendFreeform` live in the adapter package —
  not in the engine.

## Self-hosted channel setup is our problem

The UI must show, per channel: the exact webhook URL to paste, live
verification status, and a plain-English error when it fails. "Invalid OAuth
token" is not an acceptable thing to show an operator (AGENTS.md §7). Map
common failures: bad app secret → "the app secret doesn't match"; token
expired → "reconnect your Facebook/Instagram/WhatsApp account"; webhook not
reachable → "your webhook URL must be public HTTPS (Caddy provisioned one for
you)".

## Testing

- Captured real-payload fixtures (AGENTS.md §10): valid signature, invalid
  signature, duplicate delivery, echo messages, template-status callbacks.
- Never commit unscrubbed customer payloads (AGENTS.md §12) — scrub fixture
  data.

## Useful links

- Graph API webhooks: <https://developers.facebook.com/docs/graph-api/webhooks>
- Messenger platform: <https://developers.facebook.com/docs/messenger-platform>
- WhatsApp Cloud API: <https://developers.facebook.com/docs/whatsapp/cloud-api>
- Graph API versions/changelog: <https://developers.facebook.com/docs/graph-api/changelog>
