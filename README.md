# AgentBaton Platform

Task coordination broker for AI agents. TypeScript/Node/Fastify/PostgreSQL.

## Related Repos

- [agentbaton](https://github.com/agirunner/agentbaton) — Specs, requirements, design docs
- [agentbaton-runtime](https://github.com/agirunner/agentbaton-runtime) — Agentic Runtime (Go/Docker)

## Testing Documentation (Canonical in Repo)

- `docs/testing/test-plan-v1.0.md`
- `tests/reports/test-cases.v1.json` (**single source of truth** for platform test-case definitions)
- `tests/reports/traceability-matrix.md` (generated)
- `docs/testing/scenario-requirements-map.md`

## Quick Start

```bash
cd platform
pnpm install
docker-compose up -d postgres  # Start PostgreSQL
pnpm db:migrate
pnpm dev
```

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
```

- **Core lane**: deterministic AP/OT/IT/SI control-plane validations only; no live provider calls.
  - `test:core` runs the default fast subset.
  - `test:core:all` runs the full deterministic matrix.
  - Core lane rejects `--provider` and scenario selections outside the deterministic matrix.
- **Live lane**: explicit live-environment SDLC checks where LLM behavior is exercised through agent/orchestrator SUT flows.
  - Requires provider API keys and is never part of default `pnpm test`/`pnpm test:ci` gates.
  - Harness/framework code does not call provider APIs directly; providers are exercised only through SUT execution.
  - Live/integration execution is scripted-only (`pnpm test:live*` / `pnpm test:core`), no manual/ad-hoc gate execution.

### Live test evaluation configuration

Test-result interpretation defaults to deterministic schema/state assertions (no evaluator LLM).

Optional explicit evaluator config surface:
- `LIVE_EVALUATION_MODE=deterministic|llm` (default: `deterministic`)
- `LIVE_EVALUATION_PROVIDER=<openai|anthropic|google>` (required when `LIVE_EVALUATION_MODE=llm`)
- `LIVE_EVALUATION_MODEL=<model-name>` (required when `LIVE_EVALUATION_MODE=llm`)

Test outputs are written under `tests/reports/` (live harness reports in `tests/reports/live/` as paired machine + human artifacts: `run-*.json` + `run-*.md`).
