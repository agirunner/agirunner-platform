# Agirunner Platform

[![Latest Tag](https://img.shields.io/github/v/tag/agirunner/agirunner-platform?sort=semver&label=latest%20tag)](https://github.com/agirunner/agirunner-platform/tags)
[![Images](https://img.shields.io/badge/images-GHCR-2496ED?logo=docker&logoColor=white)](https://github.com/orgs/agirunner/packages?repo_name=agirunner-platform)
[![Node 22+](https://img.shields.io/badge/node-22%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/agirunner/agirunner-platform)](./LICENSE)

API-first agent orchestration plane and operator surface for Agirunner.

> Looking for the full Agirunner product, quick start, and deployment
> path? Start with
> [agirunner](https://github.com/agirunner/agirunner) and
> [docs.agirunner.dev](https://docs.agirunner.dev). This repository is
> the public implementation repo for the platform itself.

The Agirunner Platform is the part of Agirunner that defines work,
launches it, routes it, presents it to operators, and keeps the system
coherent over time. It owns playbooks, workflows, work items,
activations, approvals, operator-visible state, the dashboard, the
public API, and the fleet-management surfaces that tell runtimes what
contracts apply next.

If `agirunner-runtime` is the execution plane, `agirunner-platform` is
the place where that work gets meaning. This is the repository that
matters when you want to change how Agirunner launches work, how it
appears in the dashboard, how it exposes control surfaces over the API,
or how it coordinates runtimes and workers across a live stack.

Builders are welcome here.

If you care about workflow orchestration, operator UX, playbook-driven
work systems, approvals and assessments, runtime fleet management, or
the platform/runtime boundary, this is the public implementation repo
where those product surfaces live.

## Documentation

Product and operator documentation lives at
[`docs.agirunner.dev`](https://docs.agirunner.dev).

Useful platform entry points:

- [Getting Started](https://docs.agirunner.dev/getting-started/introduction/)
- [Dashboard Overview](https://docs.agirunner.dev/dashboard/overview/)
- [Platform Overview](https://docs.agirunner.dev/platform/overview/)
- [API Overview](https://docs.agirunner.dev/api/)
- [Architecture Overview](https://docs.agirunner.dev/architecture/overview/)

If you want the public product quick start, start with
[`agirunner`](https://github.com/agirunner/agirunner). This repository
is the right starting point when you want to work on the platform
implementation itself.

## Why This Repo Matters

An execution runtime can claim tasks and do work, but it cannot by
itself provide a real workflow product.

The platform exists to provide that product layer:

- It turns authored playbooks and live workflow state into explicit execution contracts.
- It gives operators a real dashboard instead of a thin log viewer.
- It exposes a public API for launching, steering, and supervising work programmatically.
- It records approvals, rework, evidence, artifacts, and history as durable product surfaces.
- It keeps workflow meaning in the platform and execution mechanics in the runtime, so the boundary stays understandable.

That separation is the point. `agirunner-runtime` owns claiming work,
preparing environments, running agent loops, executing tools, and
capturing results. `agirunner-platform` owns the meaning of the work
and the surfaces people and systems use to direct it.

## What Lives Here

The platform repo currently owns the major control-plane and operator
surfaces in the stack:

- the dashboard, including Mission Control, workflows, approvals, logs, settings, and runtime operations
- the public platform API used by the dashboard and external integrations
- playbooks, workflows, work items, tasks, activations, and routing state
- operator-facing approvals, assessments, rework, continuity, and artifact records
- model, role, tool, MCP, workspace, and environment policy surfaces
- the container-manager that coordinates runtime pools, worker lifecycle, and execution-fleet posture

## Platform Development Quick Start

This path is for contributors working on the platform repo directly. If
you only want to run Agirunner as a product, use the top-level stack in
[`agirunner`](https://github.com/agirunner/agirunner) instead.

```bash
git clone https://github.com/agirunner/agirunner-platform
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

1. Open the dashboard at `http://localhost:3000`.
2. Sign in with `DEFAULT_ADMIN_API_KEY` from your `.env`.
3. The platform API is available at `http://localhost:8080`.
4. Go to **Platform -> Models**, connect a provider, and set the
   default model route before trying to run useful workflow work.

If you created `.env` from `.env.example`, the bootstrap admin key is
already present on the `DEFAULT_ADMIN_API_KEY=...` line. Replace it
with your own value before sharing the stack. The first-boot seed path
expects that value to start with `ab_admin_def`. The local contributor
stack also expects `PLATFORM_SERVICE_API_KEY` so `container-manager`
can talk to `platform-api` without reusing the human bootstrap key.
Worker and agent credentials for runtime containers are then issued by
the platform as part of the normal container lifecycle.

The platform API applies migrations and seed/bootstrap work during
startup, so there is no separate root-level migration command to run.
Schema ownership and migration policy live in
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Compose Default Topology

`docker compose up -d` brings up the local control plane and its
execution wiring:

- `postgres`
- `platform-api`
- `socket-proxy`
- `container-manager`
- `dashboard`

The platform then coordinates runtime and worker processes and task
execution containers as workflows start moving.

## Runtime Image Bootstrap

This repo's local Compose path reads one runtime-image setting from
`.env`:

```env
RUNTIME_IMAGE=agirunner-runtime:local
```

The container manager uses that value as its bootstrap default, and the
platform uses the same value when it seeds the initial runtime-image
records for a fresh tenant. After that, runtime image choices belong to
the product: operators can override, rotate, or revoke them from the
dashboard or API without editing `.env` again.

The contributor stack still defaults to `agirunner-runtime:local` on
purpose so platform work can pair cleanly with a local runtime checkout.
If you want this repo to point at the published runtime line instead,
switch it with a one-line `.env` change:

```env
RUNTIME_IMAGE=ghcr.io/agirunner/agirunner-runtime:latest
```

If you remove `RUNTIME_IMAGE` entirely, bootstrap falls back to
`agirunner-runtime:local`. The `.env` value is there to choose the
initial image family, not to lock the product forever.

## Architecture Boundary

Keep this split in mind when deciding whether a change belongs here or
in `agirunner-runtime`.

| Concern | Platform | Runtime |
| --- | --- | --- |
| Playbooks, workflows, work items, approvals, governance | Owns it | Consumes explicit contracts only |
| Dashboard and public API | Owns it | Does not own it |
| Model, role, tool, environment policy | Resolves and delivers contracts | Executes the delivered contract |
| Runtime pools and worker desired state | Coordinates | Follows the platform-issued contract |
| Task claiming and execution | Coordinates and records | Performs the execution |
| Workspace creation, tool execution, result capture | Describes requirements | Does the work |

If the behavior changes because of workflow meaning, operator state, or
public API behavior, it probably belongs here. If it changes because of
execution mechanics, tool transport, workspace setup, or task-container
behavior, it probably belongs in
[`agirunner-runtime`](https://github.com/agirunner/agirunner-runtime).

## Repository Map

```text
apps/platform-api/          Fastify API, orchestration services, persistence
apps/dashboard/             operator UI for workflows, approvals, logs, and config
packages/sdk/               shared TypeScript SDK surface
services/container-manager/ Go service for runtime and worker lifecycle
tests/integration/          dashboard-backed integration coverage
tests/live/                 live workflow verification harness
```

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

## More Root Docs

- [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor setup and repo-boundary guidance
- [SECURITY.md](./SECURITY.md) for security reporting and operator expectations
- [CHANGELOG.md](./CHANGELOG.md) for the current `0.1.0` pre-release snapshot
- [MIGRATIONS.md](./MIGRATIONS.md) for database schema ownership and migration policy
