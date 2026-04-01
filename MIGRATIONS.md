# Database Migrations

`agirunner-platform` owns the product database schema.

The authoritative upgrade path is the raw SQL migration set in
[`apps/platform-api/src/db/migrations`](./apps/platform-api/src/db/migrations).
The platform API applies pending migrations automatically on startup and
records each applied filename in `schema_migrations`.

## Current Policy

- Pre-`0.1.0`, the migration chain MAY still be consolidated or reset if
  that keeps the public baseline cleaner before launch.
- After the first public release, applied migration history MUST be
  treated as forward-only. Do not rewrite or delete released migration
  files.
- The current pre-release line uses one canonical baseline file:
  `0001_init.sql`.

## Source Of Truth

- Raw SQL migrations are the upgrade source of truth.
- The schema files under
  [`apps/platform-api/src/db/schema`](./apps/platform-api/src/db/schema)
  describe the current application shape and MUST stay aligned with the
  applied SQL schema, but they do not replace migrations.
- `schema_migrations` is the applied-state ledger in each database.

## Authoring Rules

- Add a new migration whenever a released schema, index, enum, function,
  or persistent data contract needs to change.
- Use a unique, increasing numeric filename prefix going forward.
- Prefer additive, compatibility-minded changes whenever the product may
  already be deployed.
- Backfills, destructive changes, or contract-sensitive reshapes SHOULD
  be split into staged migrations when that lowers upgrade risk.
- If a migration changes public setup, contributor setup, or operator
  behavior, update the relevant docs in the same logical change.

## Testing Expectations

- Migration changes MUST include tests at the cheapest reliable layer.
- Keep deterministic startup and reset coverage for the supported
  baseline.
- Add targeted integration coverage for risky backfills, destructive
  transitions, or compatibility-sensitive upgrades.
- Delete migration replay tests once the historical path they protect is
  no longer part of the supported contract.

## Operational Posture

- Startup is the normal migration path. There is no separate root-level
  `db:migrate` command for the public stack.
- Treat upgrades as roll-forward only unless an explicit rollback path is
  documented for a specific release.
- Back up real environments before applying schema-changing releases.
