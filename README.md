# Agirunner Platform

Task coordination broker for AI agents. TypeScript/Node/Fastify/PostgreSQL.

## Related Repos

- [agirunner](https://github.com/agirunner/agirunner) — Specs, requirements, design docs
- [agirunner-runtime](https://github.com/agirunner/agirunner-runtime) — Agentic Runtime (Go/Docker)

## V2 Operator References

The active operator and integration model is V2-only:

- playbooks launch workflows
- work items move through board columns and stages
- activations wake the orchestrator
- approvals happen through stage gates and task review flows
- artifacts are previewed through platform permalinks
- memory and history are explicit workspace/workflow/work-item surfaces

Primary operator routes:

- `/mission-control` — live board
- `/work/workflows` — workflow list and workflow detail entry
- `/work/approvals` — approval queue
- `/logs` — execution inspector

Reference docs:

- `../agirunner-docs/designv2/orchestrated-workflow-architecture.md`
- `../agirunner-docs/design/v2-migration-guide.md`
- `../agirunner-docs/design/v2-release-notes.md`

## Testing Documentation (Canonical in Repo)

- `docs/testing/test-plan-v1.0.md`
- `tests/reports/test-cases.v1.json` (**single source of truth** for platform test-case definitions)
- `tests/reports/results.v1.json` (generated consolidated status matrix)
- `tests/reports/batch-results.v1.json` (generated canonical batch-run report, schema-identical to `tests/reports/results.v1.json`)
- `docs/testing/scenario-requirements-map.md`

## Quick Start

```bash
pnpm install
cp .env.example .env

docker compose up -d
pnpm db:migrate
pnpm dev
```

### Compose default topology

`docker compose up -d` now starts:

- `postgres`
- `platform-api`
- `socket-proxy`
- `architect-runtime`, `developer-runtime`, `reviewer-runtime`, `qa-runtime`, `project-manager-runtime`
- `architect-worker`, `developer-worker`, `reviewer-worker`, `qa-worker`, `project-manager-worker`
- `dashboard`

Runtimes and workers are not host-port exposed in the default topology.
`socket-proxy` + the role-specific runtimes communicate over a dedicated bridge network segment (`runtime_internal`), and each worker joins both `platform_net` and `runtime_internal` to bridge API-to-runtime traffic for its role.
For v1.1–v1.2 scope, `runtime_internal` is not marked `internal: true`, so runtime-side containers can still reach external git/LLM endpoints while keeping socket access constrained to `socket-proxy`.

Security defaults in compose/runtime profile:
- default stack uses the real Go runtime from `../agirunner-runtime`
- `/execute` is disabled by default (`EXECUTE_ROUTE_MODE=disabled`)
- `*_FILE` secret bindings mounted from `./.secrets` to `/run/secrets`
- `RUNTIME_API_KEY_FILE` required (runtime startup fails when missing/too short)
- task containers default to `${AGIRUNNER_TASK_IMAGE:-alpine/git:2.47.2}` so repository clone/push tooling is present before workspace setup runs

### Test-only compat bridge

`runtime-compat` and `platform-api /execute` are now test-only. To enable the compatibility path explicitly, start compose with the override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d
```

That override rebinds the role runtime services back to `apps/runtime-compat` and enables `/execute` in `test-simulated` mode by default. Use `EXECUTE_ROUTE_MODE=test-execution-backed` only for harness lanes that intentionally exercise the bridge.

### Prebuilt Runtime Images

To use a fetched runtime image instead of building from `../agirunner-runtime`, set:

```env
AGIRUNNER_RUNTIME_IMAGE=ghcr.io/agirunner/agirunner-runtime@sha256:...
```

The image is expected to support file-backed secret loading. Compose mounts `./.secrets` into every runtime and worker as `/run/secrets` and passes env vars such as:

- `RUNTIME_API_KEY_FILE=/run/secrets/runtime_api_key`
- `DEFAULT_ADMIN_API_KEY_FILE=/run/secrets/default_admin_api_key`
- `JWT_SECRET_FILE=/run/secrets/jwt_secret`
- `WEBHOOK_ENCRYPTION_KEY_FILE=/run/secrets/webhook_encryption_key`
- `OPENAI_API_KEY_FILE=/run/secrets/openai_api_key`

That means a pulled image does not need secrets baked in. It only needs the updated runtime binary that reads `*_FILE` env vars and the mounted `/run/secrets` directory.

### Runtime image strategy hooks

- Local default: `AGIRUNNER_RUNTIME_IMAGE=agirunner-runtime:local` built from `../agirunner-runtime`.
- Staging/release: set `AGIRUNNER_RUNTIME_IMAGE` to a digest-pinned runtime image.
- Publication helper: `scripts/runtime-image-publish.sh`
  - Builds/tag runtime image from `agirunner-runtime` repo
  - Optionally pushes to private registry
  - Writes tarball fallback artifact under `dist/images/`

See `docs/testing/v1.05-s3-compose-runtime-image-strategy.md` for stage-specific details and evidence conventions.

## Development

```bash
pnpm test       # Deterministic batch package/unit tests + harness lane guard tests
pnpm test:ci    # CI gate: pnpm test + deterministic core control-plane lane
pnpm lint       # ESLint + Prettier check
pnpm build      # TypeScript compilation
```

## Platform Validation Lanes

```bash
pnpm test:core       # Deterministic control-plane default gate (LLM-free, fast subset)
pnpm test:core:all   # Full deterministic core scenario matrix
pnpm test:live       # Live SDLC scenario lane (LLM use via SUT; requires provider API key)
pnpm test:live:all   # Full live scenario matrix across providers
pnpm test:batch      # Single-command batch (unit + core + integration/dashboard + live)
```

See `docs/testing/batch-runner.md` for CLI options, isolation model, and report schema.

- **Core lane**: deterministic AP/OT/IT/SI control-plane validations only; no live provider calls.
  - `test:core` runs the default fast subset.
  - `test:core:all` runs the full deterministic matrix.
  - Core lane rejects `--provider` and scenario selections outside the deterministic matrix.
- **Live lane**: explicit live-environment SDLC checks where LLM behavior is exercised through agent/orchestrator SUT flows.
  - Requires provider API keys and is never part of default `pnpm test`/`pnpm test:ci` gates.
  - Harness/framework code does not call provider APIs directly; providers are exercised only through SUT execution.
  - Live/integration execution is scripted-only (`pnpm test:live*` / `pnpm test:core`), no manual/ad-hoc gate execution.
  - Docker image build reuse is enabled by default for harness startup:
    - If repository image inputs are unchanged, harness runs `docker compose up -d ...` (no forced rebuild).
    - If inputs changed, harness runs `docker compose up -d --build ...`.
    - Fingerprint source is current git commit when workspace is clean; otherwise a deterministic workspace fingerprint.
    - Cache stamp path: `.cache/live-harness/compose-build-fingerprint.v1.json`.
    - Set `LIVE_FORCE_DOCKER_BUILD=true` to force rebuild and refresh cache.

### Live test evaluation configuration

Test-result interpretation defaults to deterministic schema/state assertions (no evaluator LLM).

Optional explicit evaluator config surface:

- `LIVE_EVALUATION_MODE=deterministic|llm` (default: `deterministic`)
- `LIVE_EVALUATION_PROVIDER=<openai|anthropic|google>` (required when `LIVE_EVALUATION_MODE=llm`)
- `LIVE_EVALUATION_MODEL=<model-name>` (required when `LIVE_EVALUATION_MODE=llm`)

`tests/reports/` is reserved for canonical committed JSON only (`test-cases.v1.json`, `results.v1.json`, `batch-results.v1.json`, optional `traceability*.json`).
Per-run/ad-hoc outputs (for example `run-*.json`, `run-*.md`, screenshots, Playwright JSON) are written under `tests/artifacts/` and must not be committed.
