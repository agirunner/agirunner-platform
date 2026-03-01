# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 11:30 UTC

## Product
AgentBaton Platform — coordination engine for agentic software development pipelines. Manages tasks, pipelines, templates, workers, and tenants via REST API + WebSocket + SDK + MCP server + Dashboard.

## Architecture
- **Monorepo (pnpm workspaces):**
  - `apps/platform-api/` — Express/Fastify API server (core)
  - `apps/dashboard/` — React SPA (Vite)
  - `packages/sdk/` — TypeScript SDK
  - `packages/mcp-server/` — MCP stdio server
  - `packages/config/` — Config schema + validation
  - `packages/shared-types/` — Type guards + shared types
  - `packages/test-utils/` — Test helpers
- **Database:** PostgreSQL via Drizzle ORM
- **Testing:** Vitest + testcontainers (integration), Vitest (unit)
- **Build:** TypeScript, pnpm, turbo
- **Docker:** docker-compose.yml (postgres + platform-api + dashboard) — WORKING

## Current State
- **Phase:** Code Complete + QA Audited + Test Harness Merged
- **Requirements matrix:** 207/207 ✅, 0 deferred
- **Tests:** ~279 unit/integration, build/lint/tsc clean
- **Open issues:** ZERO ✅
- **Live test harness:** `tests/live/` — 12 scenarios, ~75 validations (PR #54 merged)
- **Test plan:** `docs/test-plan-v1.0.md` v3 — autonomous pipelines, 3 worker modes

## Key Artifacts
- `docs/requirements-matrix-v1.0.md` — 207 FRs, all ✅
- `docs/requirements/platform-v1.1.md` — 28 deferred FRs
- `docs/test-plan-v1.0.md` — live test plan v3
- `tests/live/` — live test harness (12 scenarios)
- `tests/live/fixtures/calc-api/` — Express calculator fixture
- `tests/live/fixtures/todo-app/` — Node TODO app, 3 planted bugs
- `docker-compose.yml` — full stack (postgres + api + dashboard)
- `apps/platform-api/src/built-in/role-config.ts` — built-in worker roles
- `configs/built-in-roles.json` — 4 curated role configs

## Live Test Scenarios
| Scenario | Description |
|----------|-------------|
| AP-1 | Built-in worker SDLC pipeline (calc-api) |
| AP-5 | Built-in worker maintenance (todo-app planted bugs) |
| AP-7 | Failure and autonomous recovery |
| OT-1 | Dependency cascade (linear, fan-out, diamond) |
| OT-2 | Task routing and capability matching |
| OT-3 | Pipeline state derivation |
| OT-4 | Worker health and grace period |
| IT-1 | SDK full lifecycle |
| IT-2 | MCP JSON-RPC |
| SI-1 | Multi-tenant isolation |

## Remaining for v1.0.0 Tag
1. ~~Code complete~~ ✅
2. ~~All issues fixed~~ ✅
3. ~~Test harness implemented~~ ✅
4. **Execute live E2E tests** — AP-1/AP-5/AP-7/OT-1–4/IT-1–2/SI-1 (all 3 providers)
5. **Runtime integration tests** — AP-2/AP-4/AP-6 (runtime as external worker)
6. **User-facing docs** — Crusher, not started
7. **Admiral UAT sign-off**
8. **Tag v1.0.0**
