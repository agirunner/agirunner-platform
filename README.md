# AgentBaton Platform

Task coordination broker for AI agents and workers.

Stack: TypeScript, Node.js, Fastify, PostgreSQL, Docker Compose.

## First 15 minutes (fast path)

```bash
# 1) Clone + install
pnpm install

# 2) Create env
cp .env.example .env
# Edit .env and set at least: JWT_SECRET, WEBHOOK_ENCRYPTION_KEY, DEFAULT_ADMIN_API_KEY

# 3) Start full stack
docker compose up -d --build

# 4) Verify health
curl -fsS http://127.0.0.1:8080/health
# open http://127.0.0.1:3000 in your browser

# 5) Run the default deterministic gate
pnpm test:core
```

Expected:
- API health returns `{"status":"ok"}`
- Dashboard opens on port `3000`
- `pnpm test:core` completes without requiring provider API keys

---

## From-scratch setup (prereqs + environment)

### Prerequisites

- Node.js 22+
- pnpm `10.6.1` (repo packageManager)
- Docker + Docker Compose plugin
- Git

### Install dependencies

```bash
pnpm install
```

### Environment setup

Use the repo template:

```bash
cp .env.example .env
```

Required values for platform startup:

- `DATABASE_URL` (required for non-Docker local API runs)
- `JWT_SECRET` (min 32 chars)
- `WEBHOOK_ENCRYPTION_KEY` (min 32 chars)

Recommended for reproducible local/dev + worker bootstrap:

- `DEFAULT_ADMIN_API_KEY` (must start with `ab_admin_def`)

Load env for non-Docker local runs:

```bash
set -a
source .env
set +a

# Needed for non-Docker API process startup:
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
```

---

## Build and run

### Local development (API + dashboard)

1) Start PostgreSQL only:

```bash
docker compose up -d postgres
```

2) Load env (if not already exported):

```bash
set -a
source .env
set +a
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
```

3) Start repo dev processes:

```bash
pnpm dev
```

Notes:
- `pnpm dev` runs package `dev` scripts in parallel via Turbo.
- Platform API defaults to `http://127.0.0.1:8080`.
- Dashboard dev server is Vite (`apps/dashboard`), default `http://127.0.0.1:5173`.
- **Migrations are applied automatically on API startup** (`runMigrations` in app bootstrap).

### Build (monorepo)

```bash
pnpm build
```

### Standalone worker service (optional local process)

If you want the worker as a separate local process:

```bash
export PLATFORM_API_URL=http://127.0.0.1:8080
export PLATFORM_API_KEY="$DEFAULT_ADMIN_API_KEY"
pnpm --filter @agentbaton/platform-api worker:dev
```

---

## Test guide

All required test entry points:

```bash
pnpm test            # package tests + harness tests
pnpm test:ci         # CI gate: report checks + definitions + test + core
pnpm test:core       # deterministic core lane (default subset)
pnpm test:core:all   # full deterministic core matrix
pnpm test:live       # live lane (provider-backed)
pnpm test:live:all   # full live matrix across providers
pnpm test:batch      # smart batch runner (unit + core + integration + live)
```

Live lanes require provider credentials (from `.env.example` / `.env.test-batch.example`):

- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `ANTHROPIC_API_KEY`

Batch dry run (recommended before first full campaign):

```bash
pnpm test:batch --dry-run
```

---

## Docker Compose quick start

### Up

```bash
cp .env.example .env
docker compose up -d --build
```

Services:
- `postgres` (5432)
- `platform-api` (8080)
- `worker` (built-in worker process)
- `dashboard` (3000)

### Health checks

```bash
docker compose ps
curl -fsS http://127.0.0.1:8080/health
```

### Logs

```bash
docker compose logs -f platform-api
docker compose logs -f worker
docker compose logs -f dashboard
```

### Down

```bash
docker compose down
# add -v to reset database volume
# docker compose down -v
```

### Troubleshooting

- API fails at startup with env validation errors:
  - Confirm `JWT_SECRET` and `WEBHOOK_ENCRYPTION_KEY` are set and >=32 chars.
- Worker cannot register/auth:
  - Ensure `DEFAULT_ADMIN_API_KEY` is stable and matches API seed rules (`ab_admin_def...`).
- Port conflicts:
  - Override `POSTGRES_PORT`, `PLATFORM_API_PORT`, `DASHBOARD_PORT` in `.env`.
- Compose starts but health fails:
  - Check `docker compose logs -f platform-api` for migration/DB connectivity errors.

---

## Runtime + platform integration quick start

The platform expects external runtime/worker connectivity through platform worker APIs and event stream. Minimal local verification path:

1) Start platform API + Postgres:

```bash
docker compose up -d postgres platform-api
```

2) Start standalone worker process wired to the platform:

```bash
set -a
source .env
set +a

export PLATFORM_API_URL=http://127.0.0.1:8080
export PLATFORM_API_KEY="$DEFAULT_ADMIN_API_KEY"
export AGENT_API_URL=http://127.0.0.1:8080/execute
pnpm --filter @agentbaton/platform-api worker:dev
```

3) Verify worker appears in platform:

```bash
curl -fsS http://127.0.0.1:8080/api/v1/workers \
  -H "Authorization: Bearer $DEFAULT_ADMIN_API_KEY"
```

If worker registration succeeds, runtime/platform wiring is functioning (auth + register + heartbeat path).

---

## Canonical reports/artifacts and how to read them

Canonical committed report files (source of truth):

- `tests/reports/test-cases.v1.json`
  - Canonical scenario definitions and provider matrix.
- `tests/reports/results.v1.json`
  - Consolidated scenario status matrix (`PASS|FLAKY|FAIL|NOT_PASS`) and evidence references.
- `tests/reports/batch-results.v1.json`
  - Latest batch-run aggregate with stage summaries, per-stage statuses, logs, and lane artifact pointers.

Per-run/non-canonical artifacts:

- `tests/artifacts/`
  - Run-specific outputs (lane artifacts, logs, run reports, validator output, Playwright artifacts).

Interpretation quick guide:
- `PASS`: requirement/scenario met for that cell.
- `FLAKY`: intermittent result; investigate stability before promotion.
- `FAIL`: deterministic failed expectation.
- `NOT_PASS`: not yet qualified / missing validated pass evidence.

Useful references:
- `docs/testing/test-plan-v1.0.md`
- `docs/testing/scenario-requirements-map.md`
- `docs/testing/batch-runner.md`

---

## Related repos

- `enterprise/agentbaton` — product/spec context
- `enterprise/agentbaton-runtime` — runtime implementation
