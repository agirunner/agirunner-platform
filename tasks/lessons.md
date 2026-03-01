# Lessons Learned

## 2026-02-28

- **What went wrong:** Used ESLint CLI `--ext` flags with flat config, causing lint failures across workspace packages.
- **Preventive rule:** For ESLint v9 flat config projects, keep lint scripts simple (`eslint <paths>`) and avoid legacy flags.

- **What went wrong:** Test setup used `PORT=0`, but config schema enforces `PORT >= 1`, causing startup validation failures.
- **Preventive rule:** Keep test env values within the same schema bounds as production config; use non-listening valid ports when testing with Fastify `inject`.

- **What went wrong:** Added bidirectional Drizzle FK `.references()` between `tasks` and `agents` without typing the callback return, which triggered TS circular initializer inference errors (`TS7022`/`TS7024`).
- **Preventive rule:** For circular Drizzle FK callbacks, annotate with `AnyPgColumn` (e.g. `references((): AnyPgColumn => otherTable.id)`) to keep strict typecheck clean.

- **What went wrong:** New dependency cascade integration test used `claimTask`, which non-deterministically claimed unrelated ready tasks from earlier tests, causing invalid state transitions.
- **Preventive rule:** Keep integration tests isolated from global queue state; for targeted lifecycle assertions, set explicit task states/assignments directly or scope claims with strict filters.

- **What went wrong:** In a Postgres `CASE` expression during test setup, UUID columns received untyped text params, causing `column is of type uuid but expression is of type text`.
- **Preventive rule:** In SQL `CASE` updates against typed columns, cast each branch parameter explicitly (`$n::uuid`) to keep inference aligned.

- **What went wrong:** SSE integration test assumed the first stream chunk would be a business event; server emitted `: connected` heartbeat first, causing assertion failures.
- **Preventive rule:** For SSE tests, aggregate/read multiple chunks until expected event marker appears (or explicit timeout) rather than asserting on first chunk.

- **What went wrong:** Webhook e2e test subscribed to `task.completed`, but current lifecycle emits `task.state_changed` on completion.
- **Preventive rule:** Align webhook subscription filters to canonical emitted event names used by services, or add explicit event aliases before asserting downstream behavior.

- **What went wrong:** Added webhook PATCH response fields assuming an `updated_at` column existed on `webhooks`, which caused runtime 500s in integration tests.
- **Preventive rule:** Verify migration/schema columns before returning new fields from SQL updates; if uncertain, inspect DDL first.

## 2026-03-01

- **What went wrong:** Assumed `rg` was available in this environment and used it in a discovery command.
- **Preventive rule:** Prefer POSIX-safe fallback commands (`find`, `grep`, `sed`) unless tool availability is confirmed first.

- **What went wrong:** Trusted Zod inference for `z.object({ output: z.unknown() })`, but route payload inferred `output` as optional and failed service contract typing.
- **Preventive rule:** When a downstream contract requires a required key, construct an explicit payload object at call boundaries (`{ output: body.output }`) instead of relying on inferred optionality.

- **What went wrong:** Switched dashboard package test script to generic `vitest run`, which attempted to execute Playwright e2e files as unit tests.
- **Preventive rule:** Scope unit test runners to unit test globs (`src/**/*.test.ts`) when e2e specs share the same repo/package.

- **What went wrong:** Added module-level dashboard API tests without accounting for `dashboardApi` eager initialization touching `localStorage` in non-browser test runtimes.
- **Preventive rule:** Browser-only storage helpers must guard `typeof localStorage !== 'undefined'` to keep SSR/unit-test imports safe.

- **What went wrong:** `packages/config` build emitted compiled `.js` into `src/` and polluted git status because no `outDir` was configured.
- **Preventive rule:** For package builds, always set `compilerOptions.outDir` (e.g., `dist`) to keep generated artifacts out of tracked source directories.
