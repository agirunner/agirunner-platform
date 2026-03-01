# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 10:05 UTC

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
- **Phase:** Code Complete + QA Audited
- **Requirements matrix:** 207 FRs → 207/207 ✅, 0 deferred
- **Test count:** ~270 tests (unit + integration), build/lint/tsc clean
- **v1.1 doc:** `docs/requirements/platform-v1.1.md` — 28 deferred FRs
- **QA audit:** All findings resolved (PR #48 merged, Worf verified)
- **Dockerfiles:** Fixed and working (PR #50 merged)
- **Webhook secrets:** Encrypted at rest (AES-256-GCM)
- **JWT_SECRET:** No default — app fails on missing

## Open Issues
| # | Priority | Title |
|---|----------|-------|
| #14 | P1 | Offline worker recovery — no grace period |
| #18 | P1 | Dashboard stores JWTs in localStorage |
| #20 | P2 | MCP server robustness (malformed JSON-RPC) |
| #38 | P3 | 2 source-scraping assertions in test |
| #39 | P2 | Flaky auth-webhook test (race condition) |

## Remaining for v1.0 Release
1. Comprehensive test plan (Barclay — in progress)
2. Live E2E tests execution
3. Fix open P1 issues (#14, #18)
4. User-facing docs (Crusher)
5. Admiral UAT sign-off
6. Tag v1.0.0
