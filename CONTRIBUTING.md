# Contributing to Agirunner Platform

This repository is the public implementation repo for the Agirunner
control plane.

It owns the platform API, the dashboard, workflow activation and
routing, approvals and assessments, operator-visible artifacts and
memory surfaces, and runtime fleet coordination through the container
manager.

If you only want to run Agirunner as a product, start with
[`agirunner`](https://github.com/agirunner/agirunner). If you want to
change how the control plane behaves, this is the right repository.

## Choose The Right Repo

Use this repo when your change is mainly about:

- dashboard behavior or operator UX
- platform API contracts and data flow
- playbooks, workflows, work items, activations, approvals, or continuity state
- model, role, tool, MCP, or environment policy
- runtime fleet management and worker lifecycle coordination

Use
[`agirunner-runtime`](https://github.com/agirunner/agirunner-runtime)
instead when the change is mainly about:

- task execution loops
- tool transport and tool-runtime behavior
- workspace setup and repository materialization
- execution-container behavior
- runtime-side artifact capture, result packaging, or isolation

For the broader multi-repo contribution overview, see
[`agirunner/CONTRIBUTING.md`](https://github.com/agirunner/agirunner/blob/main/CONTRIBUTING.md).

## Documentation

Product-level documentation lives at
[`docs.agirunner.dev`](https://docs.agirunner.dev).

Useful platform entry points:

- [Dashboard Overview](https://docs.agirunner.dev/dashboard/overview/)
- [Platform Overview](https://docs.agirunner.dev/platform/overview/)
- [API Overview](https://docs.agirunner.dev/api/)
- [Architecture Overview](https://docs.agirunner.dev/architecture/overview/)

## Prerequisites

- Node.js 22+
- Docker
- `corepack` with `pnpm`
- Go 1.24+ if you need to work on `services/container-manager`

## Development Setup

```bash
git clone https://github.com/YOUR-USERNAME/agirunner-platform
git clone https://github.com/agirunner/agirunner-runtime ../agirunner-runtime

cd agirunner-platform
corepack pnpm install
cp .env.example .env

docker build -t agirunner-runtime:local ../agirunner-runtime

printf "JWT_SECRET=%s\nWEBHOOK_ENCRYPTION_KEY=%s\nDEFAULT_ADMIN_API_KEY=ab_admin_def%s\nPLATFORM_SERVICE_API_KEY=ar_service_%s\n" \
  "$(openssl rand -hex 32)" \
  "$(openssl rand -hex 32)" \
  "$(openssl rand -hex 16)" \
  "$(openssl rand -hex 16)"
```

Generate values with the command above, then paste them into `.env`
before you continue.

Then start the local stack:

```bash
docker compose up -d
corepack pnpm dev
```

After startup:

- dashboard: `http://localhost:3000`
- platform API: `http://localhost:8080`
- dashboard login key: `DEFAULT_ADMIN_API_KEY` from `.env`

If you created `.env` from `.env.example`, the bootstrap admin key is
already present on the `DEFAULT_ADMIN_API_KEY=...` line. Replace it
with your own value before sharing the stack. The seed path expects it
to start with `ab_admin_def`. The contributor stack also needs
`PLATFORM_SERVICE_API_KEY` so `container-manager` can authenticate to
`platform-api` without reusing the human bootstrap key. Worker and
agent credentials for runtime containers are then issued by the
platform as part of the normal container lifecycle.

The same bootstrap model applies to `RUNTIME_IMAGE`: it provides the
initial runtime image for a fresh local stack, but later runtime-image
changes belong in the dashboard or API instead of being forced back
from `.env` on every restart.

The platform API applies migrations and seed/bootstrap work during
startup, so there is no separate root-level migration command to run.
Schema policy for this repo lives in [`MIGRATIONS.md`](./MIGRATIONS.md).

## Working Norms

- Keep product language and directory structure aligned.
- Prefer explicit contracts and structured outcomes over hidden recovery logic.
- Do not hardcode secrets or machine-specific paths.
- Update docs, examples, and config templates when behavior changes.
- Keep the public repo understandable for outside contributors.

## Database Schema Changes

`agirunner-platform` owns the database schema.

- raw SQL migrations in `apps/platform-api/src/db/migrations` are the
  upgrade source of truth
- startup applies pending migrations automatically
- the current pre-`0.1.0` line uses one canonical baseline migration
- after public launch, schema history should move forward with new
  migrations instead of being rewritten

Use [`MIGRATIONS.md`](./MIGRATIONS.md) when changing schema, indexes,
enums, or persistent data contracts.

## Testing

Every feature or fix needs tests.

Common lanes:

```bash
corepack pnpm test
corepack pnpm test:v2-contract
corepack pnpm test:integration:dashboard
cd services/container-manager && go test ./...
```

If you change:

- platform API contracts, add or update API-level coverage
- dashboard behavior, prefer deterministic browser or integration coverage for user-visible regressions
- orchestration or workflow legality, add regression coverage around the affected decision point
- container-manager behavior, add Go regression coverage in `services/container-manager`

## Repository Map

```text
apps/platform-api/          Fastify API, orchestration services, persistence
apps/dashboard/             operator UI for workflows, approvals, logs, and config
packages/sdk/               shared TypeScript SDK surface
services/container-manager/ Go service for runtime and worker lifecycle
tests/integration/          dashboard-backed integration coverage
tests/live/                 live workflow verification harness
```

## Commit Style

Use conventional commits:

```text
type(scope): summary
```

Examples:

- `fix(platform-api): reject stale activation completion writes`
- `refactor(dashboard): split approval queue filters`
- `docs(platform): refresh public contribution guide`

## Security Issues

For vulnerability reports or security-sensitive findings, see
[`SECURITY.md`](./SECURITY.md). Do not open public issues for security
problems.
