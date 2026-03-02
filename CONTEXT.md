# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-02 04:56 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines.

## Current State
- **FRs:** 207/207 implemented ✅
- **Unit/integration tests:** ~279 passing ✅
- **Open issues:** 0 ✅
- **Runtime tests:** All v1.0-gating pass ✅
- **Platform tests:** AP suite re-run in progress (OpenAI first pass)

## Authoritative Docs → `enterprise/agentbaton-docs`

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

### Test governance
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
