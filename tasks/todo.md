# Live E2E Suite — Gate 5 Plan (AgentBaton v1.0)

## Scope
Build full live E2E harness for platform + runtime integration coverage in `tests/live/` with scenarios for SDLC, maintenance, and dashboard journeys.

## Execution Plan
- [x] Review existing platform API/dashboard behavior and reusable test utilities
- [x] Build harness core (`setup`, `teardown`, `repo-factory`, `report`, `runner`)
- [x] Build fixture repos (`calc-api`, `todo-app`) with deterministic reset flow
- [x] Build validators (`git`, `artifacts`, `api-state`, `events`, `dashboard`, `cost`, `cleanup`)
- [x] Build SDLC scenarios (happy + sad)
- [x] Build maintenance scenarios (happy + sad)
- [x] Build dashboard scenario suite with screenshot capture per assertion
- [x] Wire provider matrix (openai/google/anthropic) + repeat support
- [x] Add root package scripts for `test:live`, `test:live:all`, `test:live:quick`
- [x] Verify quality gates for this task: `pnpm lint` + harness TypeScript compile (`tsc --noEmit` on `tests/live/**/*.ts`)
- [x] Update `STATUS.json`, commit, push, open PR

## Notes / Risks
- Current platform API may not expose all production actions required for fully automated GitHub/Gitea PR verification; tests will validate what is externally observable via live API/events and fixture git state.
- Dashboard currently exposes a subset of required pages. Missing journeys are expected to fail as true gate findings.
- `pnpm --filter @agentbaton/platform-api build` currently fails on pre-existing unrelated TypeScript issues outside `tests/live`; harness compilation was verified directly with `tsc --noEmit` against live test sources.

---

# TypeScript Build Fixes — feature/live-test-suite

## Scope
Resolve pre-existing TypeScript errors in `apps/platform-api/src/` introduced by DIP/clean refactor and ensure full quality gates pass.

## Execution Plan
- [x] Reproduce baseline errors with `pnpm build`
- [x] Fix `DatabasePool` vs `Pool` mismatches in affected services/repositories
- [x] Fix websocket socket typing in `bootstrap/websocket.ts`
- [x] Fix template task type narrowing in pipeline engine
- [x] Fix optional `output` typing mismatch
- [x] Add null-safe handling for `rowCount`
- [x] Fix integration test select result typing
- [x] Run `pnpm build && pnpm test && pnpm lint`
- [x] Commit and push fixes to `feature/live-test-suite`
