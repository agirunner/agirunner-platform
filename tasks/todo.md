# TODO — QA audit remediation (platform)

- [x] Confirm baseline and identify all files touched by audit findings
- [x] Remove JWT secret fallback in docker compose and enforce startup failure with clear message when missing
- [x] Encrypt webhook secrets at rest (config + crypto helper + write/read paths + migration + tests)
- [x] Remove source-scraping assertion from `worker-dispatch-and-hmac.test.ts`
- [x] Add `.catch(logger.error)` to all fire-and-forget `void pool.query(...)` calls in the specified files
- [x] Resolve validation package finding (delete if unused; otherwise implement meaningful exports)
- [x] Add at least one meaningful test for `config`, `test-utils`, and `shared-types`
- [x] Run `pnpm -r exec tsc --noEmit` and fix all type errors
- [x] Run quality gates: `pnpm build && pnpm test && pnpm lint`
- [x] Evaluate `docs/requirements-matrix-v1.0.md` impact (no FR mapping changes required)
- [x] Update `STATUS.json`, commit, push branch `fix/qa-audit-platform`, and open PR
