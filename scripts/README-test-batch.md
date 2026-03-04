# Batch Test Runner (`scripts/test-batch.sh`)

This runner executes the platform verification suites and writes consolidated reports.

## Quick answer
- **Do I need to build first?**
  - **No separate pre-build step is required for the batch runner itself.**
  - Just install dependencies, set env, and run.

## Prerequisites
- Docker running
- `pnpm` available
- Provider API keys set (OpenAI/Anthropic/Google, depending on selected providers)

## Setup
```bash
pnpm install
cp .env.test-batch.example .env.test-batch
# edit .env.test-batch with your keys/settings
```

## Recommended first run
Preview only (no test execution):
```bash
pnpm test:batch --dry-run
```

## Run full batch (safe default)
Sequential mode:
```bash
pnpm test:batch --mode sequential --providers openai,google,anthropic
```

## Parallel mode (isolated lanes)
```bash
pnpm test:batch --mode parallel --continue-on-error --providers openai,google,anthropic
```
Fail fast variant:
```bash
pnpm test:batch --mode parallel --fail-fast --providers openai,google,anthropic
```

## Useful notes
- The runner is designed to isolate lanes in parallel mode (compose project names, ports, artifacts).
- It writes stage-level and consolidated reports.
- If `JWT_SECRET` / `WEBHOOK_ENCRYPTION_KEY` are not set, runner defaults can auto-generate runtime values for the run.

## Common flags
- `--mode sequential|parallel`
- `--providers openai,google,anthropic` (subset allowed)
- `--dry-run`
- `--report-dir <path>`
- `--continue-on-error` or `--fail-fast`

## Entry points
- Shell wrapper: `scripts/test-batch.sh`
- Package command: `pnpm test:batch`
