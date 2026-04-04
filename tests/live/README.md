# Live Tests

`tests/live/` is the supported end-to-end harness for real workflow runs against the local platform stack.

This README is procedure-first. It explains:

- what to configure
- how to use the one supported live-test command
- what artifacts to inspect
- when to reuse bootstrap state versus when to reseed from scratch

## Rules

- Do not add ad hoc live-test scripts outside `tests/live/`.
- Do not seed live-test state through direct database mutation.
- Shared bootstrap MUST seed runtime-facing state through platform APIs.
- Live tests MUST use the env-provided OAuth session snapshot. Do not source OAuth session state from the live database.
- OAuth snapshot normalization now runs through `tests/live/run.sh --normalize-oauth-session`; it is not a DB export path.
- Scenario verdicts are outcome-driven:
  - runner exit code `0`
  - final output artifact exists
  - DB settlement is sane
  - no persisted `5xx`
  - no fatal log anomaly
  - no dangling runtimes after settlement

## Layout

- [`env/local.env.example`](./env/local.env.example)
  - local secret/config template
- [`run.sh`](./run.sh)
  - the only supported public entrypoint for live-test setup and execution
- [`live_test_tracker.json`](./live_test_tracker.json)
  - authoritative default-batch scenario order plus explicit-only scenarios
- [`library/`](./library)
  - test-owned playbooks, roles, repo seeds, host seeds, skills, remote MCP fixtures
- [`lib/`](./lib)
  - shared Python helpers for API bootstrap and scenario execution
- [`tests/`](./tests)
  - focused helper tests for fixture parsing, catalog integrity, and capability-proof logic

Internal harness implementation files remain under:

- `scripts/prepare-live-test-shared-environment.sh`
- `scripts/prepare-live-test-run.sh`
- `scripts/run-live-scenario.sh`
- `scripts/run-live-scenario-batch.sh`
- `scripts/run-multi-orchestrator-concurrent-assessment-workflows-live-test.sh`

## Workflows Observation Scenarios

The Workflows dashboard observation slice currently adds five explicit-only scenario seeds:

- `workflows-planned-terminal-brief`
- `workflows-ongoing-intake-live`
- `workflows-needs-action-live`
- `workflows-steering-live`
- `workflows-redrive-live`

These are observation-oriented seeds for the Workflows UI campaign, not part of the default tracker batch yet.
Run them one at a time with explicit `--scenario` invocations while capturing Workflows UI evidence.

`workflows-steering-live` and `workflows-redrive-live` are currently meant to provide truthful live precursor state for manual operator observation during a headed dashboard pass.
The shared helper in [workflows_ui_evidence.py](./lib/workflows_ui_evidence.py) summarizes runner exit code, output presence, DB evidence, runtime cleanup, fatal logs, and optional deliverables provenance payloads from the resulting run artifact.

Helper verification command:

```bash
cd /path/to/agirunner-platform
python3 tests/live/tests/workflows_ui_evidence_test.py
```

## Prerequisites

- Run from the canonical repo on `main`:
  - `agirunner-platform`
- Docker and Docker Compose must be available.
- The sibling repos expected by the harness must exist:
  - `../agirunner-runtime`
  - a local fixtures clone, defaulting to `../agirunner-test-fixtures` unless `FIXTURES_REPO_PATH` overrides it
- If `../agirunner-playbooks` exists, shared bootstrap prefers that local catalog checkout and clears any inherited `COMMUNITY_CATALOG_REF` override for the live stack. Override the path with `PLAYBOOKS_REPO_PATH` if your checkout lives elsewhere.
- The local stack ports used by the harness must be free:
  - platform API default `8080`
  - postgres default `5432`

## Config

Copy the example env and fill it in:

```bash
cd /path/to/agirunner-platform
cp tests/live/env/local.env.example tests/live/env/local.env
```

`tests/live/env/local.env` is the source of truth for live-test config.

OAuth MUST be the default live-test path.
Provider and auth configuration MUST stay externalized.
The same scenario corpus MUST run against any supported provider/auth combination.

Minimum required values for the common OAuth path:

- `DEFAULT_ADMIN_API_KEY`
- `PLATFORM_SERVICE_API_KEY`
- `JWT_SECRET`
- `WEBHOOK_ENCRYPTION_KEY`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `PLATFORM_API_PORT`
- `LIVE_TEST_PROVIDER_AUTH_MODE=oauth`
- `LIVE_TEST_PROVIDER_NAME`
- `LIVE_TEST_PROVIDER_BASE_URL`
- `LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID`
- `LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON`
- `LIVE_TEST_MODEL_ID`
- `LIVE_TEST_SYSTEM_REASONING_EFFORT`
- `LIVE_TEST_ORCHESTRATOR_MODEL_ID`
- `LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT`
- `LIVE_TEST_SPECIALIST_MODEL_ID`
- `LIVE_TEST_SPECIALIST_REASONING_EFFORT`
- `LIVE_TEST_GIT_TOKEN`
- `LIVE_TEST_GIT_USER_NAME`
- `LIVE_TEST_GIT_USER_EMAIL`

If you switch to `LIVE_TEST_PROVIDER_AUTH_MODE=api_key`, add:

- `LIVE_TEST_PROVIDER_API_KEY`

Important notes:

- Keep the OAuth session in `tests/live/env/local.env`.
- Do not pull OAuth state from the DB.
- OpenAI, Anthropic, and Gemini all use the same generic provider fields; only the values differ.
- Shared bootstrap verifies that the running `platform-api` container has the same `DEFAULT_ADMIN_API_KEY`, `PLATFORM_SERVICE_API_KEY`, `JWT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` values as `tests/live/env/local.env`.
- Shared bootstrap prefers a local `agirunner-playbooks` checkout when one is available and ignores any inherited `COMMUNITY_CATALOG_REF` override in that case.

If you need to normalize the env-provided OAuth JSON shape:

```bash
cd /path/to/agirunner-platform
bash tests/live/run.sh --normalize-oauth-session
```

That command rewrites the env snapshot format only. It does not read the live DB.

## Supported Commands

Full tracker batch with automatic bootstrap/reuse:

```bash
cd /path/to/agirunner-platform
bash tests/live/run.sh
```

That default batch path runs serially unless you opt into higher concurrency.
It does not include the two local remote-MCP scenarios; those are explicit-only by design.

Single scenario:

```bash
bash tests/live/run.sh --scenario sdlc-assessment-approve
```

Rerun only failed scenarios:

```bash
bash tests/live/run.sh --failed-only
```

Batch with explicit concurrency:

```bash
bash tests/live/run.sh --concurrency 5
```

Shared bootstrap only:

```bash
bash tests/live/run.sh --bootstrap-only
```

Per-scenario preparation only:

```bash
bash tests/live/run.sh --prepare-only --scenario sdlc-assessment-approve
```

Shared bootstrap and scenario execution still use the internal scripts below. `run.sh` is the supported public command surface that chooses the right internal path for you.

## Shared Bootstrap And Reseed

`bash tests/live/run.sh --bootstrap-only` performs the full rebuild/reseed for the shared stack.

What it does:

1. loads `tests/live/env/local.env`
2. builds the runtime image from the sibling `../agirunner-runtime` checkout
3. hard-resets the fixtures repo checkout to its default branch
4. tears down the default compose stack with volumes
5. rebuilds and brings the stack back up
6. waits for `platform-api` health
7. verifies the live container secrets match `tests/live/env/local.env`
8. seeds provider defaults, model assignments, roles, playbooks, capability fixtures, and execution-environment registry through platform APIs
9. writes shared bootstrap output to:
   - `tests/live/results/bootstrap/context.json`
   - `tests/live/results/bootstrap/api-trace/api.ndjson`
10. records the runtime-calculated shared bootstrap fingerprint in `bootstrap/context.json`

This is the full rebuild/reseed path. Use it when:

- stack containers are stale or unhealthy
- secrets changed in `tests/live/env/local.env`
- provider/model config changed
- library fixtures changed
- execution-environment registry changed
- you explicitly want a brand-new shared baseline

## Single Scenario Run

Canonical command:

`bash tests/live/run.sh --scenario sdlc-assessment-approve` is the canonical single-scenario command.

You can also pass a scenario JSON path instead of a scenario name:

```bash
bash tests/live/run.sh --scenario tests/live/scenarios/sdlc-assessment-approve.json
```

What the runner does:

1. loads `tests/live/env/local.env`
2. calculates the current shared bootstrap fingerprint from the active env values, shared seed inputs, local MCP fixture inputs, and rebuild-dependent source trees
3. checks whether the shared bootstrap can be reused
4. if reuse is not valid, runs `scripts/prepare-live-test-shared-environment.sh`
5. runs `scripts/prepare-live-test-run.sh <scenario>`
6. starts the workflow through [`lib/run_workflow_scenario.py`](./lib/run_workflow_scenario.py)
7. writes final scenario output to:
   - `tests/live/results/<scenario>/workflow-run.json`

The shared bootstrap is automatically rebuilt if any of these are true:

- bootstrap context file is missing
- platform health probe fails
- the local remote MCP fixture health probe fails
- the runtime-calculated shared bootstrap fingerprint does not match the fingerprint stored in `bootstrap/context.json`

The fingerprint is calculated on every `run.sh` invocation and then persisted into the shared bootstrap context after a successful reseed. Batch coordinators calculate it once and child scenario runners only consume the already-chosen shared bootstrap contract.

## Per-Scenario Bootstrap Only

If you want to inspect or debug the per-scenario setup separately from the actual workflow run:

```bash
cd /path/to/agirunner-platform
bash tests/live/run.sh --prepare-only --scenario sdlc-assessment-approve
```

That creates:

- run context:
  - `tests/live/results/<scenario>/run-context.json`
- a unique git branch for `git_remote` scenarios
- or a unique host workspace for `host_directory` scenarios

This step reuses the already-seeded shared bootstrap. It does not rebuild the whole stack.

## Batch Runs

Run the full supported corpus in tracker order:

`bash tests/live/run.sh` runs the full supported corpus in tracker order.
That default corpus excludes `remote-mcp-oauth-client-credentials` and `remote-mcp-parameterized-fixture`.
It also excludes the `workflows-*` observation scenarios.
Run those only with explicit `--scenario` invocations.

Run with explicit concurrency:

```bash
bash tests/live/run.sh --concurrency 5
```

Rerun only scenarios that currently have failing artifacts:

```bash
bash tests/live/run.sh --failed-only
```

The batch runner:

- uses [`live_test_tracker.json`](./live_test_tracker.json) order when no explicit scenario names are provided
- performs one shared bootstrap first
- runs serially by default and concurrently only when you opt into a higher `--concurrency`
- logs `START <scenario>` when a scenario launches
- logs `PASS <scenario>` or `FAIL <scenario>` when a scenario finishes
- writes per-scenario logs under:
  - `tests/live/results/batch/`

## Artifacts

Default artifact root:

- `tests/live/results/`

Shared bootstrap artifacts:

- `tests/live/results/bootstrap/context.json`
- `tests/live/results/bootstrap/api-trace/api.ndjson`

Per-scenario artifacts:

- `<scenario>/run-context.json`
- `<scenario>/workflow-run.json`
- `<scenario>/trace/api.ndjson`
- `<scenario>/evidence/db-state.json`
- `<scenario>/evidence/capability-proof.json`
- `<scenario>/evidence/remote-mcp-fixture.json`
- `<scenario>/evidence/log-anomalies.json`
- `<scenario>/evidence/http-status-summary.json`
- `<scenario>/evidence/live-containers.json`
- `<scenario>/evidence/container-observations.json`
- `<scenario>/evidence/runtime-cleanup.json`
- `<scenario>/evidence/docker-log-rotation.json`
- `<scenario>/evidence/scenario-outcome-metrics.json`

Most useful files during triage:

- `workflow-run.json`
  - final verdict, workflow id, runner exit code
- `db-state.json`
  - workflow, task, work-item, and transition settlement
- `log-anomalies.json`
  - warning/error anomalies from execution logs
- `remote-mcp-fixture.json`
  - local MCP fixture-side proof of tool calls for local remote-MCP scenarios
- `http-status-summary.json`
  - persisted `4xx`/`5xx` summary
- `runtime-cleanup.json`
  - dangling-runtime hygiene verdict
- `scenario-outcome-metrics.json`
  - summarized loops, tokens, closure callouts, improvisation, hygiene, env usage

## Campaign Procedure

When running a multi-scenario campaign:

1. choose the baseline
2. run shared bootstrap once
3. continue from the current unresolved scenario
4. after each scenario verdict:
   - inspect `workflow-run.json`
   - inspect DB evidence
   - inspect board and stage transitions for each stage and each work item
   - inspect logs and HTTP summary
   - inspect runtime cleanup
   - update the pass/fail matrix immediately

Campaign rules:

- do not restart or clear a live-test campaign unless you explicitly intend to start a brand-new one
- do not go back to already-passed scenarios during the same campaign unless you are intentionally starting a new campaign

## Validation Procedure

Every live scenario verdict MUST be based on the settled evidence bundle, not just on whether the UI looked healthy during execution.

Per-scenario validation procedure:

1. wait for the runner to finish and write `<scenario>/workflow-run.json`
2. confirm the runner exit code in `workflow-run.json` is `0`
3. confirm the final workflow state recorded by the artifact is the scenario’s expected terminal state
   - most scenarios expect `completed`
   - some scenarios intentionally expect another terminal or parked state such as `pending`
4. confirm final output exists
   - output can be repo deliverables, uploaded artifacts, memory-backed output, or other scenario-defined final output
5. inspect `db-state.json`
   - workflow state is sane
   - tasks are settled sanely
   - work items are settled sanely
   - no stray active work remains that contradicts the recorded terminal workflow state
6. inspect board and stage transitions
   - every stage transition and work-item movement must be consistent with the terminal workflow state
   - do not rely on exact path perfection unless the scenario explicitly exists to validate that exact path
7. inspect `http-status-summary.json`
   - record `4xx` and `5xx`
   - no persisted `5xx` may remain in the settled evidence for a passing run
8. inspect `log-anomalies.json`
   - recoverable warnings are allowed if the scenario still settled correctly
   - fatal unhandled defects are not allowed
9. inspect `runtime-cleanup.json`
   - no dangling task containers
   - no undrained specialist runtimes after the scenario has settled
   - orchestrator runtimes may remain provisioned
10. inspect `scenario-outcome-metrics.json`
   - confirm the summary matches the underlying evidence
   - review closure callouts, recoverable mutation counts, loop counts, token counts, env usage, and hygiene summary
11. only after all checks agree, record the scenario verdict in the campaign matrix

The harness validates the finalized `workflow-run.json` bundle before reporting success. If the result artifact is missing, malformed, or missing any required settled evidence payload or evidence file, the runner rewrites the verdict as an explicit `harness_failure` and exits non-zero.

This validation procedure applies to single-scenario runs and to every scenario inside a batch run.

## Pass Criteria

A scenario passes only when all of the following are true:

- the runner exits with code `0`
- `workflow-run.json` exists
- `workflow-run.json` is a complete settled result bundle, not a partial JSON stub
- the final artifact reports `verification_passed = true`
- the final artifact reports the scenario’s expected terminal workflow state
- output exists in the form expected by that scenario
- DB evidence shows sane workflow, task, and work-item settlement
- board and stage transitions are sane for the settled outcome
- persisted HTTP evidence contains no `5xx`
- log anomaly review contains no fatal unhandled defect
- runtime cleanup shows no dangling task containers or undrained specialist runtimes

Detailed authored expectations are still useful diagnostics, but in outcome-driven mode they do not fail a scenario unless the scenario explicitly exists to prove that exact behavior.

## Failure Classification

When a run does not pass, classify it before fixing anything:

- harness failure
  - runner died before producing a final settled result
  - or the finalized result artifact was malformed or missing required settled evidence
- product failure
  - workflow or task state did not settle correctly
- recoverable noise
  - warnings or recoverable `4xx` occurred, but the scenario still passed all outcome checks
- stale-baseline problem
  - stack, secrets, provider config, or bootstrap context no longer match the intended test baseline

Always fix generic platform/runtime/prompt/harness causes before reaching for scenario-specific changes.

## Scenario Contract

Each scenario JSON under [`scenarios/`](./scenarios) defines:

- `profile`
  - fixture profile under `tests/live/library/<profile>/`
- `workflow`
  - workflow name, goal, launch parameters
- `workspace`
  - storage mode and workspace seed state
- `approvals`
  - scripted human decisions
- `expect`
  - scenario-specific authored checks
- `capabilities`
  - optional specialist skill / remote MCP assertions
- `coverage`
  - corpus coverage metadata

Profile directories may also include:

- `repo-seed/`
- `host-seed/`
- `skills.json`
- `remote-mcp-servers.json`

Role fixtures can refer to capabilities by slug:

- `skillSlugs`
- `mcpServerSlugs`

Shared bootstrap resolves those into fresh tenant-owned records for the run.

## Focused Helper Tests

`tests/live/tests/` contains actual helper-library tests, not runner scripts, so it stays under `tests/`.
Runnable harness entrypoints stay under `tests/live/`, `tests/live/scripts/`, and `tests/live/scenarios/`.

The kept helper tests are:

```bash
cd /path/to/agirunner-platform
python3 tests/live/tests/live_test_api.test.py
python3 tests/live/tests/live_test_catalog.test.py
python3 tests/live/tests/scenario_config.test.py
bash tests/live/tests/common_helpers.test.sh
python3 tests/live/tests/remote_mcp_configuration_matrix.test.py
python3 tests/live/tests/remote_mcp_fixture_sync.test.py
python3 tests/live/tests/specialist_capability_fixtures.test.py
python3 tests/live/tests/specialist_capability_proof.test.py
```

Verify supported remote MCP behavior through the real harness:

```bash
bash tests/live/run.sh --scenario remote-mcp-oauth-client-credentials
bash tests/live/run.sh --scenario remote-mcp-parameterized-fixture
```

## Specialist Capability Proof

Capability scenarios are split into two lanes:

- `skills`
  - seeds `skills.json`
  - assigns specialists through `skillSlugs`
  - proves prompt-layer skill availability and output markers
- `remote_mcp`
  - seeds `remote-mcp-servers.json`
  - assigns specialists through `mcpServerSlugs`
  - proves prompt availability and successful `mcp_*` tool calls
  - when the endpoint is the local fixture, also proves the fixture server itself observed the tool calls
