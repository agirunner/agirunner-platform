# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 16:49 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** ~279 passing ✅
- **Open issues:** 0 ✅
- **Live tests:** in active one-test-at-a-time validation mode

## Authoritative Docs (`docs/`)
- `docs/test-plan-v1.0.md` — platform live test scope (AP, OT, HL, IT, SI, dashboard)
- `docs/live-test-traceability.md` — per-test pass/fail/not-run status board
- `docs/requirements-matrix-v1.0.md` — FR coverage and traceability

## Platform Test Harness Links
- `tests/live/harness/runner.ts` — primary live-test runner
- `tests/live/harness/setup.ts` — environment setup/health checks
- `tests/live/harness/teardown.ts` — teardown/cleanup
- `tests/live/api-client.ts` — live API client used by scenarios
- `tests/live/scenarios/` — AP/OT/IT/SI scenario implementations

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
