# Security — credentials, logs, untrusted content

The security invariants in AGENTS.md §4.5–4.7 are the ones an operator cannot
recover from on their own. This doc is the working knowledge for
`packages/shared` (crypto, logger, errors).

## 1. Credentials encrypted at rest (invariant §4.6)

- Channel tokens and provider keys are encrypted with **AES-256-GCM** using
  `ENCRYPTION_KEY` from the environment.
- Node crypto (`node:crypto`): `createCipheriv('aes-256-gcm', key, iv)` —
  store the IV and auth tag alongside the ciphertext (AES-GCM requires
  per-encryption random IV, 12 bytes, and a 16-byte auth tag).
- Derive the key from the hex/base64 `ENCRYPTION_KEY` via `createHash('sha256')`
  or store a 32-byte key directly — pick one and document it in
  `packages/shared/src/crypto.ts`.
- **The API returns credential references and masked hints only** — never the
  plaintext, not even to an admin, not even over localhost.
- **Losing `ENCRYPTION_KEY` loses every credential.** The installer generates
  it, prints it once, and docs say to back it up (AGENTS.md §8). `backup.sh`
  includes `.env` for exactly this reason.

### Plain-English operator errors

- Wrong/rotated `ENCRYPTION_KEY` → "We can't decrypt your stored credentials.
  Restore your `ENCRYPTION_KEY` from backup." Never a stack trace.
- Failing a channel send because of a credential problem → tell the operator
  *which* channel and *what to do* ("reconnect WhatsApp in Settings").

## 2. Message bodies never enter logs (invariant §4.7)

- Use the **redacting logger** in `packages/shared/src/logger.ts`. It is the
  only logger in `api` and `worker`; no raw `console.log` (enforce with a lint
  rule).
- Log run IDs, node IDs, latencies, token counts, error codes. Never message
  text, customer names, phone numbers, email addresses, or provider tokens.
- Redaction must cover: structured log fields, error objects, and anything
  stringified into the message. If a field name matches a PII pattern
  (`phone`, `email`, `message`, `text`, `token`, `secret`…), redact by
  default and allowlist explicitly.
- Job payloads in Redis and run input storage are *data*, not logs — but treat
  them with the same caution: don't persist secrets in job payloads
  (`07-bullmq-redis.md`).

## 3. Untrusted content (invariant §4.5)

- A poisoned knowledge document or crafted customer message must **never
  invoke a tool**. Tool authority comes only from what the operator wired onto
  the agent node in the canvas.
- Retrieved chunks and inbound text are **delimited and labelled as data** in
  the prompt (`<knowledge>`, `<history>`, `<message>` blocks) — prompt
  injection can't cross the data/instruction boundary.
- Nodes marked `destructive: true` require explicit operator opt-in **on that
  node** (the canvas shows a warning and requires confirmation before publish).
- LLM output and tool results are also untrusted until validated (Zod) —
  `04-llm-gateway.md`, `08-zod-validation.md`.

## 4. Webhook integrity (invariant §4.2)

- HMAC verification on the raw body before parsing (Meta: `X-Hub-Signature-256`
  with the app secret; TikTok: per current docs — `10-tiktok-widget-channels.md`).
- Constant-time comparison (`crypto.timingSafeEqual`) for signatures and
  verify tokens.
- Never log the raw webhook body, even on verification failure — log the
  error code and channel only.

## 5. Environment

- Every env var is Zod-validated at boot (`08-zod-validation.md`); fail fast
  with a plain-English message when `ENCRYPTION_KEY`, DB URL, or Redis URL is
  missing or malformed.
- `.env` is never committed; `.env.example` documents every var with a
  comment (AGENTS.md §12).

## 6. Operational notes

- The web app and API are behind Caddy (TLS); the worker and services are on
  the internal network only (compose network config — `12-docker-deploy.md`).
- Rotating `ENCRYPTION_KEY` requires re-encrypting stored credentials —
  provide a documented rotation command in `deploy/` or admin UI, and test it
  (a half-rotated box that can't decrypt anything is an outage).

## Useful links

- Node crypto docs: <https://nodejs.org/api/crypto.html>
- OWASP AES-GCM notes: <https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html>
