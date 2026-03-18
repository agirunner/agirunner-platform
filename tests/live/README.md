# Live Tests

`tests/live/` is the single supported path for end-to-end live workflow testing.

## Rules

- No ad hoc live-testing scripts outside this folder.
- No direct DB mutation for test seeding.
- Bootstrap MUST seed runtime-facing state through platform APIs.
- Live scenarios MUST use operator-facing flows: workspace API, workflow API, fleet/DCM restart surfaces.
- Verification automation can be added incrementally, but every run MUST already write trace artifacts for debugging.

## Layout

- `prepare-live-test-environment.sh`
  - rebuilds runtime images
  - wipes the fixture repository
  - resets seeded platform state
  - seeds provider/model/workspace state through API
  - creates test-owned roles and playbooks from fixture files through API
  - restarts orchestrator through fleet API and waits for healthy DCM state
- `env/local.env.example`
  - local-only secret template for admin key, provider key, Git token, and ports
- `library/`
  - test-owned role and playbook fixtures
- `lib/`
  - shared API client and scenario helpers
- `scenarios/`
  - one executable script per live workflow scenario
- `tests/`
  - harness-level regression tests

## Artifacts

Default artifact root: `.tmp/live-tests/`

Per environment-prep run:
- `bootstrap/context.json`
- `bootstrap/api-trace/api.ndjson`

Per scenario run:
- `<scenario>/workflow-run.json`
- `<scenario>/trace/api.ndjson`

These artifacts are designed for trace-first troubleshooting now, and for automated validation later.

## First scenario

Baseline SDLC:

```bash
cp tests/live/env/local.env.example tests/live/env/local.env
# edit tests/live/env/local.env with local secrets
bash tests/live/scenarios/run-sdlc-baseline-live-test.sh
```

The scenario writes environment-prep and workflow artifacts under `.tmp/live-tests/`.
