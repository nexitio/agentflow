# Postgres + pgvector + Drizzle — knowledge for `packages/db`

AgentFlow stores relational data *and* embeddings in **Postgres** (the
`pgvector/pgvector` Docker image) — no separate vector database, because a
self-hoster will not run one. ORM is **Drizzle**, migrations run automatically
on container boot.

## Postgres version and UUIDv7

- Current stable line: **Postgres 18**. It ships a native `uuidv7()`
  function — time-sortable UUIDs as the primary key for every table
  (AGENTS.md §6: `id` on every table is UUID v7).
- Use `uuidv7()` in the DB default or generate in app code; sort by id and get
  time order for free. (Before PG18 you'd need the `pg_uuidv7` extension — not
  needed on 18.)
- Pin the image: `pgvector/pgvector` (it tracks Postgres releases; check which
  major it currently bundles) — and pin an exact tag, never `:latest`
  (AGENTS.md §4.8/§8).

## Drizzle essentials

- `drizzle-orm` (runtime) + `drizzle-kit` (CLI): schema in TS, migrations as
  SQL, no codegen service.
- Commands: `pnpm db:generate` (migration from schema changes),
  `pnpm db:migrate` (apply).
- Tables are defined in `packages/db/src/schema.ts` (or split per domain —
  follow what's already in the repo); a single Drizzle client is shared by
  `api`, `worker`, and `web`'s server components.

## Schema rules (from AGENTS.md §6)

- `id` UUID v7 on every table, `workspace_id` on **every** table (default to
  the single built-in workspace — agencies are coming; retrofit later is
  painful).
- Conversation identity key: `(channel, external_thread_id)` unique. Never
  shortcut this — cross-channel identity merging depends on it.
- Timestamps: `timestamptz`, always UTC; zone conversion happens in `web` only.
- Money: integer minor units + currency code, never float.
- Flows are versioned: editable **draft** + immutable **published snapshot**;
  runs reference the snapshot id, so editing never changes run history.
- Inbound dedupe: unique index on `(channel, external_message_id)` — the
  at-least-once backstop (invariant §4.3).
- Runs table: input, per-node output, timings, token usage, errors; plus a
  retention column for the pruning job (invariant §4.9).

## pgvector

- Extension `vector`; a `embedding vector(N)` column for knowledge chunks.
- Similarity search: `ORDER BY embedding <=> $1` (cosine distance) with an
  HNSW index (`USING hnsw (embedding vector_cosine_ops)`).
- Embeddings are generated via `packages/shared/src/llm.ts` (OpenAI-compatible
  `/v1/embeddings`) — or a configured embedding model — and stored here. No
  separate vector DB.

## Migrations (invariant §4.8)

- Forward-only, idempotent. `docker compose pull && up -d` on a box with a
  year of conversations must work unattended.
- Never drop a column in the same release that stops writing to it —
  deprecate, then remove one release later.
- Test every migration against a seeded database before merge (AGENTS.md §10).
- Migrations run automatically on container boot (`api`/`worker` wait for them
  to complete before starting).

## Gotchas

- **`timestamptz` everywhere** — Drizzle defaults can silently create
  `timestamp` without tz; set the column type explicitly.
- **Unique index on `(channel, external_message_id)`** must exist before the
  webhook code ships, or duplicates slip in under at-least-once.
- **HNSW index build time** — building on a large table at migration time can
  stall container boot; plan indexes as separate migrations with `CONCURRENTLY`
  where the operator can't wait.
- **pgvector/pgvector image vs. vanilla postgres** — the image includes the
  extension; if you ever swap images, `CREATE EXTENSION vector` fails on
  vanilla postgres.
- Connection pooling: one shared client across api/worker is fine at this
  scale; use a small pool (`pg` driver or `postgres.js` — match what the repo
  already uses) with sane limits for a 2 vCPU box.

## Useful links

- Drizzle docs: <https://orm.drizzle.team>
- pgvector README: <https://github.com/pgvector/pgvector>
- PG18 release notes (uuidv7): <https://www.postgresql.org/docs/current/release-18.html>
