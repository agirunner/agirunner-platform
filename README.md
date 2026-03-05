# AgentBaton Platform

Task coordination broker for AI agents. TypeScript/Node/Fastify/PostgreSQL.

## Related Repos

- [agentbaton](https://github.com/agirunner/agentbaton) — Specs, requirements, design docs
- [agentbaton-runtime](https://github.com/agirunner/agentbaton-runtime) — Agentic Runtime (Go/Docker)

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

### Compose default topology (v1.05 S3)

`docker compose up -d` now starts:

- `postgres`
- `platform-api`
- `socket-proxy`
- `internal-runtime` (runtime sidecar)
- `worker` (internal worker bridge, default `INTERNAL_WORKER_BACKEND=go-runtime`)
- `dashboard`

Runtime and worker are not host-port exposed in the default topology.
`socket-proxy` + `internal-runtime` communicate over a dedicated internal-only network segment (`runtime_internal`), and `worker` joins both `platform_net` and `runtime_internal` to bridge API↔runtime traffic.

Security defaults in compose/runtime profile:
- `RUNTIME_COMPAT_PROFILE=prod` (fail-closed)
- `RUNTIME_API_KEY` required (runtime startup fails when missing/too short)
- `AGENT_API_URL` required for runtime task forwarding in prod profile
- deterministic runtime fallback is disabled by default and only available with explicit test profile + flag (`RUNTIME_COMPAT_PROFILE=test`, `RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK=true`)

### Runtime image strategy hooks (S3)

- Local default: `AGENTBATON_RUNTIME_IMAGE=agentbaton-runtime:local` built from `apps/runtime-compat`.
- Staging/release: set `AGENTBATON_RUNTIME_IMAGE` to a digest-pinned runtime image.
- Publication helper: `scripts/runtime-image-publish.sh`
  - Builds/tag runtime image from `agentbaton-runtime` repo
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
