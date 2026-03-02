# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-02 17:26 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** ~279 passing ✅
- **Open issues:** 0 ✅
- **Runtime tests:** All v1.0-gating pass ✅
- **Platform tests:** AP suite re-run in progress (OpenAI first pass)

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
- `docs/testing/traceability-matrix.md`
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
