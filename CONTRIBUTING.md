# Contributing to Agirunner Platform

Thanks for contributing.

This repository owns the Agirunner control plane: the platform API, the
dashboard, workflow activation and routing, approval and assessment
records, artifact and memory surfaces, and runtime fleet coordination
through the container manager.

If your change is primarily about agent execution, tool transport,
workspace setup, execution-container behavior, or runtime-side capture,
it probably belongs in
[`agirunner-runtime`](https://github.com/agirunner/agirunner-runtime),
not here.

For the broader multi-repo contribution overview, see
[`agirunner/CONTRIBUTING.md`](https://github.com/agirunner/agirunner/blob/main/CONTRIBUTING.md).

## Prerequisites

- Node.js 22+
- Docker
- `corepack` with `pnpm`
- Go 1.24+ if you need to work on `services/container-manager`

## Development Setup

```bash
git clone https://github.com/YOUR-USERNAME/agirunner-platform
cd agirunner-platform

corepack pnpm install
cp .env.example .env
docker compose up -d postgres socket-proxy

corepack pnpm dev
```

Useful commands:

- `corepack pnpm test` runs the workspace test lanes
- `corepack pnpm test:v2-contract` runs the deterministic contract lane
- `corepack pnpm test:integration:dashboard` runs dashboard integration coverage
- `corepack pnpm lint` runs the lint lanes
- `corepack pnpm build` runs the build lanes
- `cd services/container-manager && go test ./...` runs the container-manager tests

## Repository Map

```text
apps/platform-api/         Fastify API, orchestration services, persistence
apps/dashboard/            operator UI for workflows, approvals, logs, config
packages/sdk/              shared TypeScript SDK surface
services/container-manager/ Go service for runtime and worker lifecycle
tests/integration/         dashboard-backed integration coverage
tests/live/                live workflow verification harness
```

## Architectural Boundary

When deciding where a change belongs, start with this split:

- The platform owns workflow meaning: playbooks, workflow and work-item state, routing, approvals, assessments, continuity, and operator-visible records.
- The runtime owns execution mechanics: claiming work, preparing the environment, running the loop, executing tools, and packaging results.

That boundary matters. Platform code should own the meaning of workflow actions and control-plane records instead of pushing that logic down into the runtime.

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

## Working Norms

- Keep product language and directory structure aligned.
- Prefer explicit contracts and structured outcomes over hidden recovery logic.
- Do not hardcode secrets or machine-specific paths.
- Update docs, examples, and config templates when behavior changes.
- Keep the public repo understandable for outside contributors.

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

## Questions

If you are unsure whether a change belongs here or in
`agirunner-runtime`, open the issue with the boundary question called
out directly. That is usually the key design decision in the change.
