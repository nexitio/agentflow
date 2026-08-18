# Docker + Caddy + install — knowledge for `deploy/`

AgentFlow's install story is the product's first half: one command on a clean
Ubuntu VPS, upgrades without data loss. The script in this repo
(`deploy/install.sh`) is the script operators actually run — it is reviewed
with the same care as application code (AGENTS.md §8).

## The stack (docker-compose)

| Service | Image | Public? | Notes |
| --- | --- | --- | --- |
| `caddy` | caddy | Yes | Only ingress; terminates TLS |
| `web` | built here | Behind caddy | Next.js |
| `api` | built here | Behind caddy | `/api`, `/webhooks`, `/widget` |
| `worker` | built here | No | BullMQ consumers |
| `postgres` | pgvector/pgvector | No | pin exact tag |
| `redis` | redis | No | pin exact tag |
| `omniroute` | pinned tag | No | internal network only |

- **Every image tag is pinned** in `docker-compose.yml` — never `:latest`.
  OmniRoute in particular: upstream has shipped releases that failed to boot;
  an unpinned tag turns that into our outage (AGENTS.md §2).
- Resource names: `agentflow-web`, `agentflow-api`, `agentflow-worker`,
  `agentflow-postgres`, `agentflow-redis`, `agentflow-omniroute`,
  `agentflow-caddy`; volumes `agentflow_pgdata`, `agentflow_uploads`; config at
  `/opt/agentflow`.

## install.sh requirements (AGENTS.md §8)

On a clean Ubuntu VPS it must:

1. Install Docker if missing.
2. Generate `ENCRYPTION_KEY`, DB password, admin credentials.
3. Write `.env`, pull pinned images, start the stack.
4. Provision TLS through Caddy for the operator's domain.
5. Print the URL, the admin login, and a loud warning to back up
   `ENCRYPTION_KEY`.

Rules:

- **Idempotent** — re-running never destroys data.
- Migrations run automatically on container boot (forward-only, idempotent —
  `06-postgres-drizzle.md`).
- **Health endpoint per service**; compose uses real healthchecks; `worker`
  waits for migrations to complete.
- Default footprint fits a **2 vCPU / 4 GB VPS** — test there, keep images
  lean (no dev deps in production images, `pnpm deploy:test` in CI).

## Caddy

- Caddy handles automatic TLS (Let's Encrypt) — the operator just points a
  domain at the VPS.
- `deploy/Caddyfile` routes: `web` for the UI, `/api*`, `/webhooks*`,
  `/widget*` to `api`. Webhook URLs must be stable, public, HTTPS — the
  channel setup screens show the exact URL Caddy exposes.
- Don't run another reverse proxy in front of Caddy; it's the single ingress.

## Backup / restore

- `deploy/backup.sh` and `deploy/restore.sh` cover **Postgres + uploads volume
  + `.env`** (the `.env` contains `ENCRYPTION_KEY` — without it, backups of
  the DB are partially useless since credentials are encrypted with it;
  AGENTS.md §4.6).
- Backup = `pg_dump` of the database, tar of `agentflow_uploads`, copy of
  `.env`; restore is the inverse, documented, and tested in CI.

## Upgrade path

- `docker compose pull && up -d` on a box with a year of conversations must
  work unattended (invariant §4.8).
- Migrations forward-only and idempotent; deprecate-then-remove for columns.
- CI (`pnpm deploy:test`) runs `install.sh` on a clean container, then an
  upgrade from the previous release tag, and asserts data survives (AGENTS.md §10).

## Operational gotchas

- **Healthchecks**: real checks (HTTP for api/web, `pg_isready` for postgres,
  `redis-cli ping` for redis) with `start_period` so slow first boots don't
  flap; worker's check includes "migrations complete".
- **Logs**: container logs must respect the redacting logger (invariant §4.7);
  a `docker compose logs` dump must never contain message bodies.
- **Resource limits**: set `mem_limit`/`cpus` hints so one container can't
  starve the 4 GB box.
- **`ENCRYPTION_KEY`**: generated once, printed once, backed up — and never
  logged or committed. Same for the DB password and admin credentials.
- **Do not change container/volume names between releases** — renames break
  data discovery and the backup script.

## Useful links

- Caddy docs: <https://caddyserver.com/docs>
- Docker Compose reference: <https://docs.docker.com/compose/>
