# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-05 07:20 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** platform-api suite green locally (`316 passed`, `1 skipped`) ✅
- **Open issues:** 0 ✅
- **Runtime tests:** All v1.0-gating pass ✅
- **Platform tests:** S2 platform-owned worker lifecycle/control-plane suites green; single-provider S2 batch run captured (`google`) with full PASS summary

## Platform v1.05 Campaign Status (Issue #90)
- **Active stage:** S3 — Compose default runtime topology + image strategy hooks (implemented on `feature/90-v105-s3`)
- **S0 baseline freeze snapshot:** `docs/testing/v1.05-s0-baseline-freeze.md`
- **S1 stage summary:** `docs/testing/v1.05-s1-runtime-contract-security.md`
- **S2 stage summary:** `docs/testing/v1.05-s2-go-worker-lifecycle.md`
- **S3 stage summary:** `docs/testing/v1.05-s3-compose-runtime-image-strategy.md`
- **Migration/runtime flags in scope:** `INTERNAL_WORKER_BACKEND`, `RUNTIME_URL`, `RUNTIME_API_KEY`, `TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS`, `AGENTBATON_RUNTIME_IMAGE`, `RUNTIME_DOCKER_HOST`, `RUNTIME_ENFORCE_SOCKET_PROXY`
- **S3 implementation highlights:**
  - `docker-compose.yml` (runtime sidecar + socket-proxy + go-runtime default backend + internal runtime-only network + worker least-privilege hardening)
  - `apps/runtime-compat/` (fail-closed prod profile + explicit test-only deterministic fallback controls)
  - `apps/platform-api/src/bootstrap/built-in-worker.ts` (go-runtime execution path enabled)
  - `apps/platform-api/src/built-in/runtime-api-client.ts` (runtime URL normalization)
  - `apps/platform-api/Dockerfile` (runtime stage now non-root for API/worker containers)
  - `tests/live/harness/setup.ts` + `tests/live/harness/setup.test.ts` (S3 startup topology + deterministic dashboard rate-limit budget + compose hardening assertions)
  - `scripts/runtime-image-publish.sh` + `scripts/README.md` (private registry + tar fallback hooks)
- **S3 evidence artifacts (committed):**
  - Core lane gate log: `docs/testing/evidence/s3-pnpm-test-core.log`
  - Dashboard lane gate log: `docs/testing/evidence/s3-dashboard-lane.log`
  - Default compose startup log: `docs/testing/evidence/s3-compose-default-up.log`
  - Default compose service status: `docs/testing/evidence/s3-compose-default-ps.log`
  - Runtime health check: `docs/testing/evidence/s3-runtime-health.json`
  - Internal worker online proof: `docs/testing/evidence/s3-workers-online.json`
  - Worker registration/runtime backend log: `docs/testing/evidence/s3-worker-service.log`
  - PR #94 blocker-fix runtime tests: `docs/testing/evidence/s3-pr94-fix-runtime-go-test.log`
  - PR #94 blocker-fix harness tests: `docs/testing/evidence/s3-pr94-fix-harness-tests.log`
  - PR #94 blocker-fix compose startup + hardening evidence: `docs/testing/evidence/s3-pr94-fix-compose-*.log`, `docs/testing/evidence/s3-pr94-fix-runtime-health-auth.json`, `docs/testing/evidence/s3-pr94-fix-worker-security-inspect.json`
- **Gate policy interpretation (Admiral, 2026-03-05):**
  - Inside phase gates: deterministic/unit evidence required; full live-provider matrix is out-of-scope.
  - Between gates: exactly one provider batch run is a hard gate.
  - S3 closeout follows this model and labels in-phase deterministic gates explicitly.

## Admiral Evidence Authenticity Directive (2026-03-02)
- **No stubs, no placeholder outputs, no harness-simulated execution paths** may be counted as PASS for release gating.
- For every SDLC scenario, evidence must prove **what was actually built** and validate output schema/content completeness against acceptance criteria.
- Any row backed only by control-plane/lifecycle checks must be marked **PARTIAL** or **NOT RUN** until real execution evidence exists.
- Traceability status must be derived from underlying run artifacts, not summary labels.

## Admiral Test Automation & LLM Usage Policy (2026-03-02)
- All integration and live tests must be **scripted and automated** (no manual/ad-hoc execution as gate evidence).
- Core/unit lanes should remain deterministic and batch-friendly.
- Integration/live/SDLC lanes should run real simulation; LLM use via agents/orchestrators is valid and expected when scenario requires it.
- Any LLM usage must be **configurable** for both product execution and test-result interpretation/evaluation.
- Tests requiring platform dependency belong in the platform repo.

## Requirements/Design Mirror → `enterprise/agentbaton-docs`

Internal documentation has moved to a dedicated repo. Clone:
```
https://github.com/agirunner/agentbaton-docs.git
```

### Requirements baseline (v1.0)
- `agentbaton-docs/requirements/platform-v1.0.md`
- `agentbaton-docs/requirements/product-brief.md`
- `agentbaton-docs/requirements-matrix/platform-v1.0.md`

### Design baseline (v1.0)
- `agentbaton-docs/design/platform-design.md`
- `agentbaton-docs/design/platform-v1.0-detailed.md`
- `agentbaton-docs/design/system-architecture.md`
- `agentbaton-docs/design/interface-contract-v1.0.md`
- `agentbaton-docs/design/technology-selections-v1.0.md`

### Test governance (canonical in this repo)
- `docs/testing/test-plan-v1.0.md`
- `tests/reports/results.v1.json`
- `docs/testing/scenario-requirements-map.md`

Mirror/reference copy (optional):
- `agentbaton-docs/test-plans/platform-test-plan-v1.0.md`
- `agentbaton-docs/test-traceability/platform.md`

### Standards
- `agentbaton-docs/standards/` — coding standards, quality gates, review protocol, templates

## What is under test (`tests/` — stays in this repo)
- `tests/live/harness/runner.ts` — primary live-test runner
- `tests/live/harness/setup.ts` — environment setup/health checks
- `tests/live/harness/teardown.ts` — teardown/cleanup
- `tests/live/api-client.ts` — live API client used by scenarios
- `tests/live/scenarios/` — AP/OT/IT/SI scenario implementations
- `tests/live/dashboard/*.spec.ts` — Playwright dashboard test specs
- `tests/live/validators/` — post-run validators (events, artifacts, cleanup, dashboard, cost)
- `tests/live/fixtures/calc-api/` — calculator fixture app
- `tests/live/fixtures/todo-app/` — TODO app with planted bugs

## Runtime/Worker Integration References
- `apps/platform-api/src/bootstrap/built-in-worker.ts` — built-in worker registration + lifecycle
- `apps/platform-api/src/worker-process.ts` — standalone worker entrypoint
- `apps/platform-api/src/services/worker-dispatch-service.ts` — task dispatch logic
- `docker-compose.yml` — stack topology + worker services

## Remaining for v1.0.0 Tag
- Finish all platform test-plan scenarios green (AP suite in progress)
- AP-2/4/6 integration tests (runtime as external worker)
- Run stability gate (qualification ×1 frontier models, then ×25 cheap models)
- User-facing docs
- Admiral UAT sign-off
- Tag v1.0.0
