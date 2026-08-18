# BullMQ + Redis — knowledge for `apps/worker`

AgentFlow uses **BullMQ** on **Redis** for all async work. The worker consumes
jobs: flow execution, ingestion from channel webhooks, outbound sends.

## Architecture

```
Channel webhook → api: verify → dedupe → enqueue → 200 OK (<100ms)
                                        ↓
                    worker: load published flow → engine.run()
                            → trigger node → agent node → tools
                            → outbound adapter
```

- The API **only enqueues** — it never executes flows, calls LLMs, or sends
  messages. That's what keeps webhooks under 100ms (invariant §4.2).
- The worker is the only place `packages/nodes` runtimes and the engine run.
- Redis also serves the widget SSE fan-out (pub/sub) — check current usage in
  the repo and reuse the same connection.

## BullMQ essentials

- Queues: `ingest` (webhook payloads), `flow-run` (execute a published flow
  for a message), `outbound` (send replies), maybe `prune` (retention job).
- Worker: `new Worker(queueName, processor, { connection })` — the processor
  is a plain async function; it must be idempotent (any handler may run twice,
  invariant §4.3).
- BullMQ v5+ uses `ioredis`-style connection config; use the shared Redis
  client from the repo (never open a second pool casually).

## At-least-once semantics

- Providers retry. Inbound dedupe is enforced by the unique index
  `(channel, external_message_id)` in Postgres — the queue is *not* the
  dedupe mechanism, it's the delivery mechanism.
- **Every outbound send carries an idempotency key** (invariant §4.3) so a
  retried job can't double-send. Generate the key per logical message
  (e.g., `reply:{channel}:{external_thread_id}:{runId}:{stepId}`) and pass it
  to the channel adapter's send call.
- Job retries: BullMQ `attempts` + `backoff` for transient failures; make the
  processor idempotent *before* enabling retries.

## Job design

- **Enqueue fast, process later.** The webhook handler builds a minimal,
  Zod-validated payload and enqueues. Do not serialize secrets or message
  bodies into job payloads beyond what the processor needs (log hygiene,
  invariant §4.7 — job data is visible to anyone with Redis access).
- **Dead-lettering.** Configure `removeOnFail` plus a dead-letter/`failed`
  handler that records the failure against the run (persisted, invariant §4.9)
  and alerts the operator in plain English.
- **Concurrency.** Set `concurrency` per queue so the worker doesn't hammer a
  2 vCPU box; LLM calls are I/O-bound so modest concurrency is fine.
- **Priorities/flow producers.** BullMQ Flows (producer/child jobs) fit the
  outbound-send-after-agent pattern; keep it simple — a single job per message
  that performs the whole run is usually enough for v1.

## Retry, backoff, and timeouts

- LLM calls get their own timeout/retry inside `packages/shared/src/llm.ts`
  (see `04-llm-gateway.md`) — don't rely on the queue retry to fix a slow
  provider, or jobs pile up.
- A stuck run should fail loudly as a typed error, not hang the worker: use
  per-job timeouts and lock expiration (`lockDuration`), and make the engine's
  run state resumable only if it's cheap — otherwise treat a crashed run as a
  failed run and persist the partial output (invariant §4.9).

## Redis operations

- Redis is a container on the operator's box (`agentflow-redis`), pinned tag.
- Persistence: enable AOF/RDB so a restart doesn't silently lose queued jobs
  (at-least-once means the queue must survive restarts; losing jobs is losing
  messages).
- Healthcheck: `redis-cli ping`; compose uses real healthchecks (invariant §8).

## Useful links

- BullMQ docs: <https://docs.bullmq.io>
- BullMQ GitHub: <https://github.com/taskforcesh/bullmq>
