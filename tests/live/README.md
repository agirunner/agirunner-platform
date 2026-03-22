# Live Tests

`tests/live/` is the single supported path for end-to-end live workflow testing.

## Rules

- No ad hoc live-testing scripts outside this folder.
- No direct DB mutation for test seeding.
- Bootstrap MUST seed runtime-facing state through platform APIs.
- Live scenarios MUST use operator-facing flows: workspace API, workflow API, fleet/DCM restart surfaces.
- OAuth MUST be the default live-test path.
- Provider and auth configuration MUST stay externalized so the same scenario corpus can run against any supported provider/auth combination.
- The same scenario corpus MUST run against any supported provider/auth combination.
- `tests/live/env/local.env` SHOULD hold the current known-good OAuth session snapshot for repeatable runs.
- `tests/live/export-current-oauth-session.sh` SHOULD be used to refresh that local env snapshot from the live database when the operator intentionally wants to promote the current DB session.

## Layout

- `prepare-live-test-shared-environment.sh`
  - rebuilds runtime and execution images
  - resets seeded platform state once for the full corpus
  - seeds provider/model defaults plus all test-owned roles and playbooks through API
  - restarts orchestrator capacity through fleet API and waits for healthy DCM state
- `prepare-live-test-run.sh`
  - creates a unique workspace and run context for a single scenario
  - creates a unique git branch or host-directory root for that run
  - binds the run to the already-seeded profile registry from the shared bootstrap
- `export-current-oauth-session.sh`
  - exports the currently connected OAuth session for the configured profile from the live platform database
- `env/local.env.example`
  - local-only secret template for admin key, OAuth session snapshot, optional API-key paths, Git token, and ports
- `library/`
  - realistic role and playbook fixtures for the assessment abstraction matrix
- `lib/`
  - shared API client, catalog, and scenario helpers
- `scenarios/`
  - scenario JSON files plus thin executable wrappers
- `tests/`
  - harness-level regression tests

## Scenario Contract

Each live scenario is defined by a JSON file under `tests/live/scenarios/`.

- `profile`
  - points to `tests/live/library/<profile>/` for the test-owned playbook, roles, and optional `repo-seed/`
- `workflow`
  - declares the workflow name, goal, and launch parameters
- `workspace`
  - declares the workspace storage mode plus memory/spec state seeded through workspace APIs
- `approvals`
  - ordered scripted human decisions using `approve`, `reject`, or `request_changes`
- `expect`
  - declarative pass criteria evaluated by the runner; generic keys include direct handoff, assessment, approval, subject revision, and required-assessment assertions
- `coverage`
  - matrix metadata used by the catalog tests to prove that the scenario corpus covers the supported semantic, concurrency, storage, and playbook-shape variations

The generic runner is:

```bash
bash tests/live/scenarios/run-live-scenario.sh sdlc-assessment-approve
```

The batch runner is:

```bash
bash tests/live/scenarios/run-live-scenario-batch.sh 5
```

Thin per-scenario wrappers call that runner for convenience.

## Matrix

The current corpus is intentionally realistic rather than toy-like. It spans:

- SDLC delivery with direct successor, specialist assessment, optional assessment, and multi-assessor rework
- requirements and publication pipelines with human review and mixed artifact/memory outputs
- ongoing intake flows
- host-directory maintenance flows
- concurrency and race-condition stress scenarios
- custom role-image coverage

## Artifacts

Default artifact root: `.tmp/live-tests/`

Per environment-prep run:
- `bootstrap/context.json`
- `bootstrap/api-trace/api.ndjson`

Per scenario run:
- `<scenario>/workflow-run.json`
- `<scenario>/trace/api.ndjson`

These artifacts are designed for trace-first troubleshooting and later automated validation.
