# Scripts

## Batch Test Runner (`scripts/test-batch.sh`)

This runner executes the platform verification suites and writes consolidated reports.

## Quick answer

- **Do I need to build first?**
  - **No separate pre-build step is required for the batch runner itself.**
  - The runner can auto-bootstrap missing workspace deps (`pnpm install --frozen-lockfile`) and Playwright Chromium when needed.

## Prerequisites

- Docker running
- `pnpm` available
- Provider API keys set (OpenAI/Anthropic/Google, depending on selected providers)
  - If `--providers` is omitted, missing provider keys are auto-skipped with a warning so non-live lanes still run.
  - Skipped providers are still represented as `live-<provider>` stages with `status=skipped` and `notRunReason=missing-provider-credentials` in `summary.{json,md}`.

## Setup

```bash
# optional but recommended for first clone (runner will self-bootstrap if missing)
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
- Docker lane ports are selected from configured bases with deterministic collision fallback when host ports are already in use.
- It writes stage-level and consolidated reports.
- CLI output includes `summaryJson=` and `summaryMd=` absolute paths; these files are verified to exist before the run exits.
- Bootstrap logs (dependency/browser setup) are written to `<reportDir>/bootstrap/`.
- Docker-backed lanes auto-set `AGENT_API_URL` to the lane-local platform API `/execute` endpoint when not explicitly provided, satisfying AP-7 fail-closed preflight requirements.
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

---

## Runtime image strategy helper (`scripts/runtime-image-publish.sh`)

Used in v1.05 S3 to support private-registry publish + tarball fallback flow.

### What it does

- Builds runtime image from a local runtime repository checkout (`../agentbaton-runtime` by default)
- Tags runtime image for private registry (`registry.github.com/enterprise-private/agentbaton-runtime:<tag>`)
- Exports OCI tarball fallback under `dist/images/`
- Writes JSON manifest with image/tar metadata

### Example

```bash
# Build + tar fallback only (no push)
./scripts/runtime-image-publish.sh

# Build + push + tar fallback
PUSH_IMAGE=true ./scripts/runtime-image-publish.sh
```
