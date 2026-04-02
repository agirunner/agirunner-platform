# Dashboard Integration Suite

`tests/integration/dashboard/` is the supported operator surface for dashboard integration coverage.

Operator surfaces:
- [`env/local.env.example`](./env/local.env.example)
  - env checklist for the values this suite expects
- [`run.sh`](./run.sh)
  - default Playwright suite entrypoint
- [`seed-load.sh`](./seed-load.sh)
  - targeted load-fixture seeding helper
- [`benchmark-load.sh`](./benchmark-load.sh)
  - targeted benchmark/load helper

Usage:

```bash
bash tests/integration/dashboard/run.sh
bash tests/integration/dashboard/run.sh workflows-live.spec.ts
bash tests/integration/dashboard/seed-load.sh
bash tests/integration/dashboard/benchmark-load.sh
```

Environment:
- `run.sh` and [`support/platform-env.ts`](./support/platform-env.ts) read repo-root `.env` first, then repo-root `.env.example`, with process env overrides winning
- [`env/local.env.example`](./env/local.env.example) lists the keys this suite depends on; copy the values you need into repo-root `.env` or export them before running
- default mode is `PLAYWRIGHT_SKIP_WEBSERVER=1`, which expects the local platform stack and postgres to already be available
- in that default mode, `run.sh` rejects active runtime-specialist containers and unsettled `E2E %` workflow activations before and after the run
- use `PLAYWRIGHT_SKIP_WEBSERVER=0` only when you intentionally want the Playwright-managed stack path instead of the existing local stack guard

Artifacts:
- `ARTIFACT_LOCAL_ROOT` defaults to `tmp/integration-artifacts`
- Playwright output remains under `tests/integration/dashboard/test-results/`
