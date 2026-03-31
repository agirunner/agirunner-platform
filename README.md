# Agirunner Platform

[![Latest Tag](https://img.shields.io/github/v/tag/agirunner/agirunner-platform?sort=semver&label=latest%20tag)](https://github.com/agirunner/agirunner-platform/tags)
[![GHCR](https://img.shields.io/badge/container-GHCR-2496ED?logo=docker&logoColor=white)](https://github.com/orgs/agirunner/packages/container/package/agirunner-platform)
[![Node 22+](https://img.shields.io/badge/node-22%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/agirunner/agirunner-platform)](./LICENSE)

Control plane for Agirunner.

The Agirunner Platform is the system that defines, launches, routes,
observes, and governs work. It owns playbooks, workflows, work items,
approvals, operator-facing state, the dashboard, the public API, and the
runtime fleet management surfaces that tell execution systems what to do
next.

If the runtime is the part of Agirunner that does the work, the platform
is the part that decides what work exists, which contracts apply, what
operators should see, and how the product remains coherent over time.

Builders are welcome here.

If you care about workflow orchestration, operator UX, approvals and
assessments, API design, observability, or the platform/runtime
boundary, this is the repository where those product surfaces live.

## Documentation

Product and operator documentation lives at
[`docs.agirunner.dev`](https://docs.agirunner.dev).

Useful platform entry points:

- [Getting Started](https://docs.agirunner.dev/getting-started/introduction/)
- [Dashboard Overview](https://docs.agirunner.dev/dashboard/overview/)
- [Platform Overview](https://docs.agirunner.dev/platform/overview/)
- [API Overview](https://docs.agirunner.dev/api/)
- [Architecture Overview](https://docs.agirunner.dev/architecture/overview/)

## Why This Exists

An agent runtime can execute tasks, but it cannot by itself provide a
product-quality workflow system.

The platform exists to provide that control plane:

- It turns authored playbooks and current workflow state into explicit execution contracts.
- It gives operators a real dashboard instead of a thin log viewer.
- It exposes a public API for launching and supervising work programmatically.
- It records approvals, rework, history, artifacts, and other workflow state as durable product surfaces.
- It keeps workflow meaning in the platform and execution mechanics in the runtime, so the boundary stays understandable.

That separation is the point. `agirunner-runtime` owns claiming work,
preparing environments, running the agent loop, executing tools, and
capturing results. `agirunner-platform` owns the meaning of the work and
the surfaces people and systems use to direct it.

## Where It Fits

```text
agirunner
  └─ full-stack entry point, product docs, roadmap, and release framing

agirunner-platform
  └─ control plane
     - dashboard and public API
     - playbooks, workflows, and work items
     - routing and orchestration activations
     - approvals, assessments, and operator state
     - model, role, tool, and environment policy
     - fleet management and runtime-facing contracts

agirunner-runtime
  └─ execution plane
     - claim task
     - prepare workspace
     - run isolated execution
     - execute tools
     - capture outputs and artifacts
     - report status and logs back
```

Within a running system, the platform flow looks like this:

```text
Operator or API client launches workflow
                |
                v
Platform creates workflow, work items, and activation state
                |
                v
Orchestrator is activated with current workflow context
                |
                v
Platform routes work and issues task contracts
                |
                v
Runtime claims tasks and executes them
                |
                v
Platform stores logs, artifacts, approvals, and operator-visible results
```

## What Makes The Platform Valuable

### Workflow system, not prompt session

The platform lets teams define reusable process through playbooks, then
launch that process repeatedly with new context. That is a much better
operating model than treating every run as a fresh ad hoc prompt.

### Real operator surfaces

The dashboard is part of the product contract. Operators can launch
work, watch board state, inspect evidence, steer workflows, review
deliverables, and manage settings without dropping into raw logs or
database state.

### API-first control plane

The same control plane that powers the dashboard is exposed through the
platform API, which means Agirunner can be embedded into larger systems
instead of being trapped inside one UI.

### Explicit runtime contracts

The platform resolves model, role, tool, and environment policy before a
task reaches the runtime. That keeps execution explicit and reduces the
chance that workflow semantics leak into the execution layer.

### Evidence and continuity

Artifacts, logs, workspace records, approvals, and history are durable
product surfaces. The platform stores and presents them so operators can
understand what happened and what should happen next.

## Dashboard And API Surfaces

The platform currently ships major operator and integration surfaces
such as:

- Mission Control workflow operations
- playbook and workspace authoring
- specialist, skill, model, and tool configuration
- runtime environment and settings management
- live logs and live container diagnostics
- API keys and platform-wide settings
- public API route groups for workflows, tasks, workspaces, artifacts, logs, runtimes, workers, and integrations

Reference docs:

- [`docs.agirunner.dev/dashboard/overview/`](https://docs.agirunner.dev/dashboard/overview/)
- [`docs.agirunner.dev/platform/overview/`](https://docs.agirunner.dev/platform/overview/)
- [`docs.agirunner.dev/api/`](https://docs.agirunner.dev/api/)

## Quick Start

```bash
corepack pnpm install
cp .env.example .env

docker compose up -d
corepack pnpm dev
```

After startup:

- open the dashboard at `http://localhost:3000`
- the platform API listens at `http://localhost:8080`
- sign in with the `DEFAULT_ADMIN_API_KEY` value from your `.env`

In the default local Compose setup, the dashboard login screen is also
prefilled with `DEFAULT_ADMIN_API_KEY`, so you usually only need to
confirm it and sign in.

If you created `.env` by copying `.env.example`, the admin key is the
`DEFAULT_ADMIN_API_KEY=...` value in that file. Replace it with your own
bootstrap key before sharing the environment. The first-boot seed path
expects that value to start with `ab_admin_def`.

The platform API runs migrations and seed/bootstrap work during startup,
so there is no separate `db:migrate` command to run in the root
workspace.

The stack still needs at least one working model provider before
workflows can execute useful work. After first login, go to
**Platform -> Models**, configure a provider, and set a default route.

### Compose Default Topology

`docker compose up -d` brings up the local control plane and its
execution wiring:

- `postgres`
- `platform-api`
- `socket-proxy`
- `container-manager`
- `dashboard`

The platform then coordinates runtime and worker processes and task
execution containers as workflows start moving.

Security defaults in the local stack include:

- runtime and worker access mediated through the container manager and socket proxy
- secrets supplied through `.env` and runtime mounts instead of being baked into images
- the default admin login key coming from `DEFAULT_ADMIN_API_KEY`
- task containers using an image with git tooling present for repository materialization

### Runtime Image Strategy

Today, the default local Compose path still expects a local runtime
image tag (`agirunner-runtime:local`). Keeping `agirunner-runtime` next
to this repo is the easiest way to satisfy that current developer
default when you are iterating on the runtime itself.

That is a local-development convenience, not the intended long-term
deployment model. The direction of the stack is to point the platform at
a pinned published runtime image, with the sibling runtime checkout only
needed when you are actively changing the runtime.

For release or staging environments, set the runtime image explicitly:

```env
AGIRUNNER_DEFAULT_RUNTIME_IMAGE=ghcr.io/agirunner/agirunner-runtime@sha256:...
```

Use digest-pinned runtime images anywhere you care about reproducibility.

## Platform Image Workflows

This repository includes the same release workflow pattern as the
runtime repo for the primary platform API image built from
`apps/platform-api/Dockerfile`.

Manual workflows:

- `.github/workflows/platform-manual-build.yml`
  - runs `corepack pnpm test`
  - builds `agirunner-platform:<image_tag>` in the GitHub runner
- `.github/workflows/platform-manual-publish.yml`
  - runs `corepack pnpm test`
  - publishes `ghcr.io/<owner>/agirunner-platform:<image_tag>`

Release workflow:

- `.github/workflows/platform-release-publish.yml`
  - triggers on pushed tags matching `v*`
  - runs `corepack pnpm test`
  - publishes `ghcr.io/<owner>/agirunner-platform:<tag-without-leading-v>`

These workflows do not publish anything until you trigger them manually
or push a matching release tag.

## Development

```bash
corepack pnpm test
corepack pnpm test:v2-contract
corepack pnpm test:integration:dashboard
corepack pnpm lint
corepack pnpm build
```

If you need to work on the fleet coordinator directly:

```bash
cd services/container-manager
go test ./...
```

## Testing Documentation

- `docs/testing/test-plan-v1.0.md`
- `tests/reports/test-cases.v1.json`
- `tests/reports/results.v1.json`
- `tests/reports/batch-results.v1.json`
- `docs/testing/scenario-requirements-map.md`
- `tests/live/README.md`

## Related Repos

- [agirunner](https://github.com/agirunner/agirunner): top-level product docs, roadmap, and full-stack entry point
- [agirunner-runtime](https://github.com/agirunner/agirunner-runtime): execution plane, tool execution, isolated workspaces, and runtime capture
