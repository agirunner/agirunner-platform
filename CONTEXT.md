# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 16:50 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** ~279 passing ✅
- **Open issues:** 0 ✅
- **Live tests:** in active one-test-at-a-time validation mode

## Authoritative Docs (`docs/`)

### Requirements baseline (v1.0)
- `docs/requirements/platform-v1.0.md`
- `docs/requirements/product-brief.md`
- `docs/requirements-matrix-v1.0.md`

### Design baseline (v1.0)
- `docs/design/platform-design.md`
- `docs/design/platform-v1.0-detailed.md`
- `docs/design/system-architecture.md`
- `docs/design/interface-contract-v1.0.md`
- `docs/design/technology-selections-v1.0.md`

### Test governance
- `docs/test-plan-v1.0.md`
- `docs/live-test-traceability.md`

## What is under test (`tests/`)
- `tests/live/harness/runner.ts` — primary live-test runner
- `tests/live/harness/setup.ts` — environment setup/health checks
- `tests/live/harness/teardown.ts` — teardown/cleanup
- `tests/live/api-client.ts` — live API client used by scenarios
- `tests/live/scenarios/` — AP/OT/IT/SI scenario implementations
- `tests/live/dashboard/*.spec.ts` — Playwright dashboard test specs
- `tests/live/validators/` — post-run validators (events, artifacts, cleanup, dashboard, cost)

## Runtime/Worker Integration References
- `apps/platform-api/src/bootstrap/built-in-worker.ts` — built-in worker registration + lifecycle
- `apps/platform-api/src/worker-process.ts` — standalone worker entrypoint
- `apps/platform-api/src/services/worker-dispatch-service.ts` — task dispatch logic
- `docker-compose.yml` — stack topology + worker services

## Active Execution Protocol (Admiral Order)
1. Run one test at a time from `docs/test-plan-v1.0.md`.
2. If failed: Data fix → Worf review → retest same test.
3. After each test: update `docs/live-test-traceability.md`, commit, push.
4. Report result and next test; pause for instruction.

## Remaining for v1.0.0 Tag
- Finish all runtime + platform test-plan scenarios green
- Run stability gate (`--repeat 25`)
- User-facing docs
- Admiral UAT sign-off
- Tag v1.0.0
