# CONTEXT.md — AgentBaton Platform v1.0

## Last Updated
2026-03-01 05:22 UTC

## Product
AgentBaton Platform — a coordination engine for agentic software development pipelines. Manages tasks, pipelines, templates, workers, and tenants via REST API + WebSocket + SDK + MCP server + Dashboard.

## Architecture
- **Monorepo (pnpm workspaces):**
  - `apps/platform-api/` — Express API server (core)
  - `apps/dashboard/` — React SPA (Vite)
  - `packages/sdk/` — TypeScript SDK
  - `packages/mcp-server/` — MCP stdio server
- **Database:** PostgreSQL via Drizzle ORM
- **Testing:** Vitest + testcontainers (integration), Vitest (unit)
- **Build:** TypeScript, pnpm, turbo

## Current State
- **Phase:** Code Complete — all v1.0 FRs implemented + tested
- **Main HEAD:** `afa8585` (docs: remove 28 deferred FRs)
- **Requirements matrix:** 207 FRs total → 199 ✅ Covered, 8 🔜 Deferred (built-in worker FRs — PR #44 in review)
- **Test count:** ~312 tests (unit + integration), 0 failures, 1 skipped
- **v1.1 doc:** `docs/requirements/platform-v1.1.md` — 28 deferred FRs organized by theme

## In-Flight Work
- **PR #44** (open): 8 built-in worker FRs (FR-743/745/747/748/749/750/751/753) — Worf rejected, Data fixing 3 issues (#45/#46/#47)
- After PR #44 merges: matrix goes to 207/207 ✅, 0 🔜

## Open Issues
| # | Priority | Title |
|---|----------|-------|
| #45 | P2 | FR-750: prohibitedOperations not runtime-enforced |
| #46 | P3 | All 4 roles share identical modelPreference |
| #47 | P3 | Output validator integer range tests missing |
| #39 | P2 | Flaky auth-webhook.test.ts |
| #38 | P3 | isOriginAllowed test has 2 source-scraping lines |
| #21 | P2 | Missing CORS policy |
| #20 | P2 | MCP server robustness |
| #19 | P1 | SDK realtime token leak |
| #18 | P1 | Dashboard stores JWTs in localStorage |
| #15 | P1 | Hardcoded operational values (Milestone D) |
| #14 | P1 | Offline worker recovery — no grace period |
| #13 | P1 | Webhook hardcoded tenant |
| #12 | P0 | Webhook signature non-constant-time comparison |

**Note:** Issues #12-#21 are from pre-audit security review. Most were addressed in code but issues not closed on Gitea. Verify before closing.

## Key Files
- `docs/requirements/platform-v1.0.md` — requirements spec
- `docs/requirements/platform-v1.1.md` — deferred FRs
- `docs/requirements-matrix-v1.0.md` — traceability matrix
- `docs/design/platform-architecture.md` — architecture doc
- `apps/platform-api/src/` — API source
- `apps/platform-api/configs/built-in-roles.json` — role configs
- `apps/platform-api/tests/` — test suites
- `apps/dashboard/src/` — dashboard source
- `tests/live/` — live E2E test suite (not yet run)

## Branching
- `main` — protected, squash-merge only
- `feature/*` — feature branches
- `fix/*` — fix branches
- `docs/*` — docs-only branches

## Git Access
- SSH: `https://github.com/agirunner/agentbaton-platform.git`
- SSH key: `~/.ssh/gitea/<agent-name>`

## Remaining for v1.0 Release
1. Merge PR #44 (built-in worker FRs) after Worf approval
2. QA comprehensive audit (Barclay)
3. Fix outstanding P0/P1 issues or verify already fixed
4. Live E2E tests (`pnpm test:live --all --repeat 25`)
5. User-facing docs (Crusher)
6. Admiral UAT sign-off
7. Tag v1.0.0
