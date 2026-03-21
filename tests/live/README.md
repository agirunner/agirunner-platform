# Live Tests

`tests/live/` is the single supported path for end-to-end live workflow testing.

## Rules

- No ad hoc live-testing scripts outside this folder.
- No direct DB mutation for test seeding.
- Bootstrap MUST seed runtime-facing state through platform APIs.
- Live scenarios MUST use operator-facing flows: workspace API, workflow API, fleet/DCM restart surfaces.
- Verification automation can be added incrementally, but every run MUST already write trace artifacts for debugging.
- OpenAI live-test bootstrap MUST use the OAuth-backed subscription provider through platform APIs.
- OAuth live tests MAY import a pre-authorized session snapshot through admin APIs when the scenario is validating execution paths rather than the OAuth browser flow itself.
- `tests/live/env/local.env` SHOULD hold the current known-good OAuth session snapshot for repeatable runs.
- `tests/live/export-current-oauth-session.sh` SHOULD be used to refresh that local env snapshot from the live database when the operator intentionally wants to promote the current DB session.

## Layout

- `prepare-live-test-environment.sh`
  - rebuilds runtime images
  - wipes the fixture repository
  - resets seeded platform state
  - seeds provider/model/workspace state through API
  - creates test-owned roles and playbooks from fixture files through API
  - restarts orchestrator through fleet API and waits for healthy DCM state
- `export-current-oauth-session.sh`
  - exports the currently connected OAuth session for the configured profile
    from the live platform database
  - prints a reusable session JSON snapshot to stdout or writes it to a file
  - uses the same export path that `prepare-live-test-environment.sh` uses in
    OAuth mode when no explicit `LIVE_TEST_OAUTH_SESSION_JSON` is provided
- `env/local.env.example`
  - local-only secret template for admin key, OpenAI OAuth session snapshot, Git token, and ports
- `library/`
  - test-owned role and playbook fixtures
- `lib/`
  - shared API client and scenario helpers
- `scenarios/`
  - scenario JSON files plus thin executable wrappers
- `tests/`
  - harness-level regression tests

## Scenario Contract

Each live scenario is defined by a JSON file under `tests/live/scenarios/`.

- `profile`
  - points to `tests/live/library/<profile>/` for the test-owned playbook, roles, and optional `repo-seed/`
- `workflow`
  - declares the workflow name, goal, and extra launch parameters
- `workspace`
  - declares whether the workspace is repo-backed plus any memory/spec state to seed through workspace APIs
- `approvals`
  - ordered scripted gate decisions using `approve`, `reject`, or `request_changes`
- `expect`
  - declarative pass criteria evaluated by the runner; a scenario exits non-zero if they are not met
  - MAY include `efficiency` ceilings derived from execution logs so the same scenario proves both correctness and bounded latency/loop churn

The generic runner is:

```bash
bash tests/live/scenarios/run-live-scenario.sh sdlc-baseline
```

Thin per-scenario wrappers can call that runner for convenience.

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
