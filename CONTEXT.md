# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-05 11:08 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** platform-api suite green locally (`340 passed`, `1 skipped`) ✅
- **Open issues:** 0 ✅
- **Runtime tests:** All v1.0-gating pass ✅
- **Platform tests:** S2 platform-owned worker lifecycle/control-plane suites green; single-provider S2 batch run captured (`google`) with full PASS summary

## Platform v1.05 Campaign Status (Issue #90)
- **Active stage:** S4 — API surface/design contract closure (implemented on `feature/90-v105-s4`)
- **S0 baseline freeze snapshot:** `docs/testing/v1.05-s0-baseline-freeze.md`
- **S1 stage summary:** `docs/testing/v1.05-s1-runtime-contract-security.md`
- **S2 stage summary:** `docs/testing/v1.05-s2-go-worker-lifecycle.md`
- **S3 stage summary:** `docs/testing/v1.05-s3-compose-runtime-image-strategy.md`
- **S4 implementation highlights:**
  - Added Projects API contract surface (`/api/v1/projects` CRUD + `/api/v1/projects/:id/memory` merge patch)
  - Added missing API contract closures: pipeline delete, task retry `override_input`/`force`, worker-next alias, inbound git webhook receiver (`/api/v1/webhooks/git`), websocket subscribe/filter compatibility endpoint (`/api/v1/events/ws`)
  - Normalized envelopes/auth details: success `meta.request_id`/`meta.timestamp`, error-code normalization (`CYCLE_DETECTED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`), auth token `expires_at`, refresh rotation + logout invalidation + CSRF hardening
  - Enforced Admiral S4 directive: built-in worker go-runtime only; legacy-node mode deprecated/disabled in active/default operation with migration note `docs/decisions/DECISION-003-built-in-worker-go-runtime-only.md`
  - Aligned API key canonical format to `ab_{scope}_{random}` with legacy verification compatibility and MCP tool namespace to `baton_*` with aliases
- **S4 evidence artifacts (committed):**
  - Gate tests: `docs/testing/evidence/s4-pnpm-test.log`, `docs/testing/evidence/s4-pnpm-test-ci.log`
  - Go-only deprecation trace: `docs/testing/evidence/s4-go-only-deprecation.log`
- **Gate policy interpretation (Admiral, 2026-03-05):**
  - Inside phase gates: deterministic/unit evidence required; full live-provider matrix is out-of-scope.
  - Between gates: exactly one provider batch run is a hard gate.
  - S4 closeout follows this model and labels in-phase deterministic gates explicitly.

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
