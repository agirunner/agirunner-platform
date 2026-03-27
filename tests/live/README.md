# Live Tests

`tests/live/` is the supported end-to-end harness for real workflow runs against the local platform stack.

This README is procedure-first. It explains:

- what to configure
- how to rebuild and reseed the shared live-test stack
- how to run one scenario or a batch
- what artifacts to inspect
- when to reuse bootstrap state versus when to reseed from scratch

## Rules

- Do not add ad hoc live-test scripts outside `tests/live/`.
- Do not seed live-test state through direct database mutation.
- Shared bootstrap MUST seed runtime-facing state through platform APIs.
- Live tests MUST use the env-provided OAuth session snapshot. Do not source OAuth session state from the live database.
- `tests/live/export-current-oauth-session.sh` only normalizes the env-provided OAuth snapshot; it is not a DB export path.
- Scenario verdicts are outcome-driven:
  - runner exit code `0`
  - final output artifact exists
  - DB settlement is sane
  - no persisted `5xx`
  - no fatal log anomaly
  - no dangling runtimes after settlement

## Layout

- [env/local.env.example](/home/mark/codex/agirunner-platform/tests/live/env/local.env.example)
  - local secret/config template
- [prepare-live-test-shared-environment.sh](/home/mark/codex/agirunner-platform/tests/live/prepare-live-test-shared-environment.sh)
  - full rebuild + reseed for the shared stack
- [prepare-live-test-run.sh](/home/mark/codex/agirunner-platform/tests/live/prepare-live-test-run.sh)
  - per-scenario workspace/run-context bootstrap
- [scenarios/run-live-scenario.sh](/home/mark/codex/agirunner-platform/tests/live/scenarios/run-live-scenario.sh)
  - canonical single-scenario runner
- [scenarios/run-live-scenario-batch.sh](/home/mark/codex/agirunner-platform/tests/live/scenarios/run-live-scenario-batch.sh)
  - canonical batch runner
- [live_test_tracker.json](/home/mark/codex/agirunner-platform/tests/live/live_test_tracker.json)
  - authoritative supported-scenario order
- [library](/home/mark/codex/agirunner-platform/tests/live/library)
  - test-owned playbooks, roles, repo seeds, host seeds, skills, remote MCP fixtures
- [lib](/home/mark/codex/agirunner-platform/tests/live/lib)
  - shared Python helpers for API bootstrap and scenario execution
- [tests](/home/mark/codex/agirunner-platform/tests/live/tests)
  - harness-level regression tests

## Prerequisites

- Run from the canonical repo on `main`:
  - [agirunner-platform](/home/mark/codex/agirunner-platform)
- Docker and Docker Compose must be available.
- The sibling repos expected by the harness must exist:
  - `/home/mark/codex/agirunner-runtime`
  - `/home/mark/codex/agirunner-test-fixtures`
- The local stack ports used by the harness must be free:
  - platform API default `8080`
  - postgres default `5432`

## Config

Copy the example env and fill it in:

```bash
cd /home/mark/codex/agirunner-platform
cp tests/live/env/local.env.example tests/live/env/local.env
```

`tests/live/env/local.env` is the source of truth for live-test config.

OAuth MUST be the default live-test path.
Provider and auth configuration MUST stay externalized.
The same scenario corpus MUST run against any supported provider/auth combination.

Minimum required values:

- `DEFAULT_ADMIN_API_KEY`
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
- `LIVE_TEST_PROVIDER_OAUTH_SESSION_SOURCE=env`
- `LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON`
- `LIVE_TEST_MODEL_ID`
- `LIVE_TEST_SYSTEM_REASONING_EFFORT`
- `LIVE_TEST_ORCHESTRATOR_MODEL_ID`
- `LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT`
- `LIVE_TEST_ORCHESTRATOR_REPLICAS`
- `LIVE_TEST_SPECIALIST_MODEL_ID`
- `LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE`
- `LIVE_TEST_SPECIALIST_REASONING_EFFORT`
- `LIVE_TEST_GITHUB_TOKEN`

Optional keys used only by scenarios that need them:

- `LIVE_TEST_TAVILY_API_KEY`
- `LIVE_TEST_EXA_API_KEY`

Important notes:

- Keep the OAuth session in `tests/live/env/local.env`.
- Do not pull OAuth state from the DB.
- Shared bootstrap verifies that the running `platform-api` container has the same `DEFAULT_ADMIN_API_KEY`, `JWT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` values as `tests/live/env/local.env`.

If you need to normalize the env-provided OAuth JSON shape:

```bash
cd /home/mark/codex/agirunner-platform
bash tests/live/export-current-oauth-session.sh
```

That script rewrites the env snapshot format only. It does not read the live DB.

## Shared Bootstrap And Reseed

Use this when you want a clean shared baseline for the corpus:

```bash
cd /home/mark/codex/agirunner-platform
bash tests/live/prepare-live-test-shared-environment.sh
```

What it does:

1. loads `tests/live/env/local.env`
2. builds the runtime image from `/home/mark/codex/agirunner-runtime`
3. hard-resets the fixtures repo checkout to its default branch
4. tears down the default compose stack with volumes
5. rebuilds and brings the stack back up
6. waits for `platform-api` health
7. verifies the live container secrets match `tests/live/env/local.env`
8. seeds provider defaults, model assignments, roles, playbooks, capability fixtures, and execution-environment registry through platform APIs
9. writes shared bootstrap output to:
   - [bootstrap/context.json](/home/mark/codex/agirunner-platform/.tmp/live-tests/bootstrap/context.json)
   - [bootstrap/api-trace/api.ndjson](/home/mark/codex/agirunner-platform/.tmp/live-tests/bootstrap/api-trace/api.ndjson)

This is the full rebuild/reseed path. Use it when:

- stack containers are stale or unhealthy
- secrets changed in `tests/live/env/local.env`
- provider/model config changed
- library fixtures changed
- execution-environment registry changed
- you explicitly want a brand-new shared baseline

## Single Scenario Run

Canonical command:

```bash
cd /home/mark/codex/agirunner-platform
bash tests/live/scenarios/run-live-scenario.sh sdlc-assessment-approve
```

You can also pass a scenario JSON path instead of a scenario name:

```bash
bash tests/live/scenarios/run-live-scenario.sh tests/live/scenarios/sdlc-assessment-approve.json
```

What the runner does:

1. loads `tests/live/env/local.env`
2. checks whether the shared bootstrap can be reused
3. if reuse is not valid, runs `prepare-live-test-shared-environment.sh`
4. runs `prepare-live-test-run.sh <scenario>`
5. starts the workflow through [lib/run_workflow_scenario.py](/home/mark/codex/agirunner-platform/tests/live/lib/run_workflow_scenario.py)
6. writes final scenario output to:
   - `.tmp/live-tests/<scenario>/workflow-run.json`

The shared bootstrap is automatically rebuilt if any of these are true:

- bootstrap context file is missing
- platform health probe fails
- requested provider/model/auth config does not match the existing bootstrap context
- requested profile is missing from bootstrap context
- bootstrap context does not contain seeded execution environments

## Per-Scenario Bootstrap Only

If you want to inspect or debug the per-scenario setup separately from the actual workflow run:

```bash
cd /home/mark/codex/agirunner-platform
bash tests/live/prepare-live-test-run.sh sdlc-assessment-approve
```

That creates:

- run context:
  - `.tmp/live-tests/<scenario>/run-context.json`
- a unique git branch for `git_remote` scenarios
- or a unique host workspace for `host_directory` scenarios

This step reuses the already-seeded shared bootstrap. It does not rebuild the whole stack.

## Batch Runs

Run the full supported corpus in tracker order:

```bash
cd /home/mark/codex/agirunner-platform
bash tests/live/scenarios/run-live-scenario-batch.sh
```

Run with explicit concurrency:

```bash
bash tests/live/scenarios/run-live-scenario-batch.sh 5
```

Rerun only scenarios that currently have failing artifacts:

```bash
bash tests/live/scenarios/run-live-scenario-batch.sh --failed-only
```

The batch runner:

- uses [live_test_tracker.json](/home/mark/codex/agirunner-platform/tests/live/live_test_tracker.json) order when no explicit scenario names are provided
- performs one shared bootstrap first
- runs scenarios concurrently
- writes per-scenario logs under:
  - `.tmp/live-tests/batch/`

## Artifacts

Default artifact root:

- [/.tmp/live-tests](/home/mark/codex/agirunner-platform/.tmp/live-tests)

Shared bootstrap artifacts:

- [bootstrap/context.json](/home/mark/codex/agirunner-platform/.tmp/live-tests/bootstrap/context.json)
- [bootstrap/api-trace/api.ndjson](/home/mark/codex/agirunner-platform/.tmp/live-tests/bootstrap/api-trace/api.ndjson)

Per-scenario artifacts:

- `<scenario>/run-context.json`
- `<scenario>/workflow-run.json`
- `<scenario>/trace/api.ndjson`
- `<scenario>/evidence/db-state.json`
- `<scenario>/evidence/capability-proof.json`
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

This validation procedure applies to single-scenario runs and to every scenario inside a batch run.

## Pass Criteria

A scenario passes only when all of the following are true:

- the runner exits with code `0`
- `workflow-run.json` exists
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
- product failure
  - workflow or task state did not settle correctly
- recoverable noise
  - warnings or recoverable `4xx` occurred, but the scenario still passed all outcome checks
- stale-baseline problem
  - stack, secrets, provider config, or bootstrap context no longer match the intended test baseline

Always fix generic platform/runtime/prompt/harness causes before reaching for scenario-specific changes.

## Scenario Contract

Each scenario JSON under [scenarios](/home/mark/codex/agirunner-platform/tests/live/scenarios) defines:

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

## Harness Regression Tests

Run the harness tests with:

```bash
cd /home/mark/codex/agirunner-platform
python3 tests/live/tests/live_test_catalog.test.py
python3 tests/live/tests/scenario_config.test.py
python3 tests/live/tests/seed_live_test_environment.test.py
python3 tests/live/tests/seed_live_test_run.test.py
python3 tests/live/tests/run_workflow_scenario.test.py
bash tests/live/tests/prepare-live-test-shared-environment.test.sh
bash tests/live/tests/prepare-live-test-run.test.sh
bash tests/live/tests/run-live-scenario.test.sh
bash tests/live/tests/run-live-scenario-batch.test.sh
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
