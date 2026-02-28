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
