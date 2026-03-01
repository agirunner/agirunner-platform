# Bulk Test Backfill — feature/test-backfill-batch

## Objective
Close all remaining ⚠️ requirements-matrix gaps by adding real unit/integration assertions and updating matrix references.

## Plan
- [ ] Baseline: capture remaining ⚠️ count from `tasks/remaining-gaps.md` (173)
- [ ] Add lifecycle coverage file for FR-001..FR-013a (+ FR-SM-001/002/003/007)
- [ ] Add tenant isolation coverage file for FR-149..FR-160 (+ FR-761)
- [ ] Add pipeline/template full coverage file for FR-161..FR-177 (+ FR-400..FR-412, FR-700..FR-720, FR-822/824)
- [ ] Add context/memory + sub-task coverage file for FR-178..FR-193 and FR-205..FR-209
- [ ] Add dashboard API contract coverage file for FR-030..FR-037, FR-420..FR-429, FR-SM-006
- [ ] Add auth/webhook coverage file for FR-027..FR-029, FR-044..FR-048, FR-054, FR-210..FR-212, FR-426a
- [ ] Extend MCP/SDK tests for FR-038..FR-043
- [ ] Add worker/runtime/env coverage file for remaining worker/cross-cutting FRs (FR-023/025/026/097/215..222/280..299/740..756/760..763/818..821)
- [ ] Update `docs/requirements-matrix-v1.0.md` to mark all checklist ⚠️ rows as ✅ with test file references
- [ ] Update coverage summary/status breakdown counts
- [ ] Run `pnpm build && pnpm test && pnpm lint`
- [ ] Update STATUS.json + memory log
- [ ] Commit, push branch, open PR
