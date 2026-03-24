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
- Live tests MUST use the env-provided OAuth session snapshot. Do not source OAuth session state from the live database.
- `tests/live/export-current-oauth-session.sh` normalizes and validates the env-provided OAuth snapshot only; it is not a database export path.

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
  - validates and rewrites the env-provided OAuth session snapshot into `env/local.env`
- `env/local.env.example`
  - local-only secret template for admin key, OAuth session snapshot, optional API-key paths, Git token, and ports
- `library/`
  - realistic role and playbook fixtures for the assessment abstraction matrix
- `lib/`
  - shared API client, catalog, and scenario helpers
- `live_test_tracker.json`
  - long-term corpus tracker for all supported scenarios plus the reserved `unsupported_future_design` bucket
  - the `supported.scenarios` order is the authoritative unattended execution order for the corpus
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
  - ordered scripted human decisions using `approve`, `block`, `reject`, or `request_changes`
- `expect`
  - declarative pass criteria evaluated by the runner; generic keys include direct handoff, assessment, approval, work-item field matching, stage-gate field matching, subject revision, ordering, and required-assessment assertions
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

When no explicit scenario names are passed, the batch runner uses `live_test_tracker.json` order rather than filesystem sort.

Thin per-scenario wrappers call that runner for convenience.

## Matrix

The current corpus is intentionally realistic rather than toy-like. It spans:

- SDLC delivery with direct successor, specialist assessment, optional assessment, and multi-assessor rework
- requirements and publication pipelines with human review and mixed artifact/memory outputs
- ongoing intake flows
- host-directory maintenance flows
- concurrency and race-condition stress scenarios
- custom role-image coverage
- prose-driven governance scenarios across SDLC, requirements, publishing, host-directory, and concurrency flows

Long-term corpus planning lives in:

- [live_test_tracker.json](/home/mark/codex/agirunner-platform/tests/live/live_test_tracker.json)
  - `supported`
    - every scenario that is currently valid to seed and run
  - `unsupported_future_design`
    - reserved for any future scenarios that are intentionally documented but not yet runnable

## Artifacts

Default artifact root: `.tmp/live-tests/`

Per environment-prep run:
- `bootstrap/context.json`
- `bootstrap/api-trace/api.ndjson`

Per scenario run:
- `<scenario>/workflow-run.json`
- `<scenario>/trace/api.ndjson`
- `<scenario>/evidence/db-state.json`
- `<scenario>/evidence/log-anomalies.json`
- `<scenario>/evidence/live-containers.json`
- `<scenario>/evidence/container-observations.json`
- `<scenario>/evidence/runtime-cleanup.json`
- `<scenario>/evidence/docker-log-rotation.json`

These artifacts are designed for trace-first troubleshooting and later automated validation.

## Pass Criteria

No scenario counts as passing until all of these checks agree:

- the scenario runner exits with code `0`
- final artifact shows the expected workflow result
- DB evidence shows clean workflow, task, and work-item settlement for the scenario semantics
- board and stage progression evidence shows the scenario reached the expected work-item columns, completion markers, and stage/workflow terminal posture for that playbook
- log anomaly review shows no unexplained terminal defect
- container hygiene evidence shows no dangling task containers and no undrained cold runtimes left behind after the scenario has settled

Container hygiene is mandatory because a workflow can appear complete while runtime ownership or cleanup is still broken. Review `live-containers.json`, `container-observations.json`, and `runtime-cleanup.json` before recording a pass.
Board and stage progression is mandatory because a workflow can appear busy or complete while work items remain in the wrong board column, stages never reconcile, or the workflow stays active after all work is terminal. Review `db-state.json` and the workflow snapshot for work-item `completed_at`, board column, stage status, and workflow state before recording a pass.
