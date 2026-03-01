# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 10:35 UTC

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
- **Phase:** Code Complete + QA Audited + Test Plan Written
- **Requirements matrix:** 207 FRs → 207/207 ✅, 0 deferred
- **Test count:** ~270 tests (unit + integration), build/lint/tsc clean
- **v1.1 doc:** `docs/requirements/platform-v1.1.md` — 28 deferred FRs
- **QA audit:** All findings resolved (PR #48 merged, Worf verified)
- **Dockerfiles:** Fixed and working (PR #50 merged)
- **Webhook secrets:** Encrypted at rest (AES-256-GCM)
- **JWT_SECRET:** No default — app fails on missing
- **Test plan:** `docs/test-plan-v1.0.md` — developer journeys, autonomous runs, config variants (commit 6f05a20)

## Open Issues
| # | Priority | Title |
|---|----------|-------|
| #14 | P1 | Offline worker recovery — no grace period |
| #18 | P1 | Dashboard stores JWTs in localStorage |
| #20 | P2 | MCP server robustness (malformed JSON-RPC) |
| #38 | P3 | 2 source-scraping assertions in test |
| #39 | P2 | Flaky auth-webhook test (race condition) |

Data is currently fixing all 5 issues (spawn v2 running).

## Key Artifacts
- `docs/requirements-matrix-v1.0.md` — 207 FRs, all ✅
- `docs/requirements/platform-v1.1.md` — 28 deferred FRs
- `docs/test-plan-v1.0.md` — live test plan (7 developer journeys, 4 config variants, 7 capability tests)
- `tests/live/` — live test harness (4 scenarios, validators, fixtures)
- `tests/live/fixtures/calc-api/` — Express calculator fixture
- `tests/live/fixtures/todo-app/` — Node TODO app with 3 planted bugs
- `docker-compose.yml` — full stack (postgres + api + dashboard)
- `apps/platform-api/src/built-in/role-config.ts` — built-in worker roles
- `configs/built-in-roles.json` — 4 curated role configs (developer, reviewer, architect, qa)

## Remaining for v1.0 Release
1. ~~Test plan~~ ✅ Written and merged
2. Fix 5 open issues (Data — in progress)
3. Implement test plan scenarios as executable code (Barclay — next)
4. Execute live E2E tests
5. User-facing docs (Crusher)
6. Admiral UAT sign-off
7. Tag v1.0.0
