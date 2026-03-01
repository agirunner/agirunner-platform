# Complete Remaining Test Backfill — feature/complete-test-backfill

## Scope
Close remaining requirements-matrix ⚠️/❌ gaps by adding implementation + unit/integration coverage, while leaving Docs and Live Tests columns unchanged.

## Plan
- [x] Inventory all remaining ⚠️/❌ rows from `docs/requirements-matrix-v1.0.md` and baseline counts
- [x] Implement missing FRs that currently have no implementation/tests (focus on non-deferred)
- [x] Add dedicated unit tests mapped to FR IDs
- [x] Add dedicated integration tests mapped to FR IDs
- [x] Update matrix rows to ✅ only where implementation + unit + integration are present
- [x] Recompute and update coverage summary at top (255 FRs total)
- [x] Run `pnpm build && pnpm test && pnpm lint`
- [ ] Update STATUS.json and daily memory log
- [ ] Commit, push branch, open PR
