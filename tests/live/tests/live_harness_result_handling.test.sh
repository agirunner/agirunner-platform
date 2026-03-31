#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
LIVE_TEST_ROOT="${PLATFORM_ROOT}/tests/live"
RUN_SCENARIO_SCRIPT="${LIVE_TEST_ROOT}/scripts/run-live-scenario.sh"
RUN_BATCH_SCRIPT="${LIVE_TEST_ROOT}/scripts/run-live-scenario-batch.sh"

make_test_env() {
  local root="$1"

  mkdir -p "${root}/env" "${root}/scripts" "${root}/scenarios" "${root}/results"
  cat >"${root}/env/local.env" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
JWT_SECRET=test-jwt
WEBHOOK_ENCRYPTION_KEY=test-webhook
EOF
}

write_noop_bootstrap_scripts() {
  local root="$1"

  cat >"${root}/scripts/shared-bootstrap.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
EOF
  chmod +x "${root}/scripts/shared-bootstrap.sh"

  cat >"${root}/scripts/bootstrap.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
EOF
  chmod +x "${root}/scripts/bootstrap.sh"
}

test_run_live_scenario_marks_incomplete_result_as_harness_failure() {
  local temp_root
  temp_root="$(mktemp -d)"
  trap 'rm -rf "${temp_root}"' RETURN

  make_test_env "${temp_root}"
  write_noop_bootstrap_scripts "${temp_root}"

  cat >"${temp_root}/scenarios/demo.json" <<'EOF'
{
  "name": "demo",
  "profile": "demo",
  "workflow": {
    "name": "Demo workflow",
    "goal": "Exercise live harness result validation."
  },
  "workspace": {
    "storage": {
      "type": "workspace_artifacts"
    }
  }
}
EOF

  cat >"${temp_root}/scripts/runner.py" <<'EOF'
#!/usr/bin/env python3
from pathlib import Path
import json
import os

tmp_path = Path(os.environ["LIVE_TEST_SCENARIO_RUN_TMP_FILE"])
tmp_path.write_text(
    json.dumps(
        {
            "scenario_name": os.environ["LIVE_TEST_SCENARIO_NAME"],
            "runner_exit_code": 0,
            "workflow_state": "completed",
            "state": "completed",
            "verification_passed": True,
            "verification": {"passed": True, "failures": []},
            "harness_failure": False,
            "outcome_metrics": {"status": "passed"},
            "evidence": {
                "db_state": {"ok": True}
            }
        }
    ),
    encoding="utf-8",
)
EOF
  chmod +x "${temp_root}/scripts/runner.py"

  set +e
  LIVE_TEST_ENV_FILE="${temp_root}/env/local.env" \
    LIVE_TEST_ARTIFACTS_DIR="${temp_root}/results" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${temp_root}/results/bootstrap/context.json" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${temp_root}/scripts/shared-bootstrap.sh" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${temp_root}/scripts/bootstrap.sh" \
    LIVE_TEST_START_WORKFLOW_SCRIPT="${temp_root}/scripts/runner.py" \
    "${RUN_SCENARIO_SCRIPT}" "${temp_root}/scenarios/demo.json"
  status=$?
  set -e

  if [[ "${status}" -eq 0 ]]; then
    echo "expected incomplete workflow-run artifact to fail loud" >&2
    exit 1
  fi

  python3 - "${temp_root}/results/demo/workflow-run.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["harness_failure"] is True, payload
assert payload["verification"]["passed"] is False, payload
assert any("missing required evidence payload" in failure for failure in payload["verification"]["failures"]), payload
PY
}

test_run_live_scenario_clears_stale_evidence_and_fails_when_runner_emits_no_result() {
  local temp_root
  temp_root="$(mktemp -d)"
  trap 'rm -rf "${temp_root}"' RETURN

  make_test_env "${temp_root}"
  write_noop_bootstrap_scripts "${temp_root}"

  cat >"${temp_root}/scenarios/demo.json" <<'EOF'
{
  "name": "demo",
  "profile": "demo",
  "workflow": {
    "name": "Demo workflow",
    "goal": "Exercise missing-result handling."
  },
  "workspace": {
    "storage": {
      "type": "workspace_artifacts"
    }
  }
}
EOF

  mkdir -p "${temp_root}/results/demo/evidence"
  cat >"${temp_root}/results/demo/evidence/db-state.json" <<'EOF'
{"stale":true}
EOF

  cat >"${temp_root}/scripts/runner.py" <<'EOF'
#!/usr/bin/env python3
from pathlib import Path
import os

Path(os.environ["LIVE_TEST_SCENARIO_RUN_TMP_FILE"]).unlink(missing_ok=True)
EOF
  chmod +x "${temp_root}/scripts/runner.py"

  set +e
  LIVE_TEST_ENV_FILE="${temp_root}/env/local.env" \
    LIVE_TEST_ARTIFACTS_DIR="${temp_root}/results" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${temp_root}/results/bootstrap/context.json" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${temp_root}/scripts/shared-bootstrap.sh" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${temp_root}/scripts/bootstrap.sh" \
    LIVE_TEST_START_WORKFLOW_SCRIPT="${temp_root}/scripts/runner.py" \
    "${RUN_SCENARIO_SCRIPT}" "${temp_root}/scenarios/demo.json"
  status=$?
  set -e

  if [[ "${status}" -eq 0 ]]; then
    echo "expected missing workflow-run artifact to fail loud" >&2
    exit 1
  fi

  if [[ -e "${temp_root}/results/demo/evidence/db-state.json" ]]; then
    echo "expected stale evidence to be cleared before the new run" >&2
    exit 1
  fi

  python3 - "${temp_root}/results/demo/workflow-run.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["harness_failure"] is True, payload
assert payload["verification"]["passed"] is False, payload
assert payload["harness"]["exit_code"] == 1, payload
assert any("workflow-run.json not found" in failure for failure in payload["verification"]["failures"]), payload
PY
}

test_batch_failed_only_reruns_missing_and_incomplete_results() {
  local temp_root
  temp_root="$(mktemp -d)"
  trap 'rm -rf "${temp_root}"' RETURN

  make_test_env "${temp_root}"
  write_noop_bootstrap_scripts "${temp_root}"

  cat >"${temp_root}/tracker.json" <<'EOF'
{
  "supported": {
    "scenarios": [
      "pass",
      "missing",
      "incomplete"
    ]
  }
}
EOF

  for scenario in pass missing incomplete; do
    cat >"${temp_root}/scenarios/${scenario}.json" <<EOF
{
  "name": "${scenario}",
  "profile": "demo",
  "workflow": {
    "name": "${scenario} workflow",
    "goal": "Exercise --failed-only selection."
  },
  "workspace": {
    "storage": {
      "type": "workspace_artifacts"
    }
  }
}
EOF
  done

  mkdir -p "${temp_root}/results/pass/evidence" "${temp_root}/results/incomplete/evidence"
  python3 - "${temp_root}/results/pass/workflow-run.json" <<'PY'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
evidence_dir = result_path.parent / "evidence"
required_keys = [
    "db_state",
    "execution_environment_usage",
    "capability_proof",
    "remote_mcp_fixture",
    "log_anomalies",
    "http_status_summary",
    "live_containers",
    "container_observations",
    "runtime_cleanup",
    "docker_log_rotation",
    "scenario_outcome_metrics",
    "workspace_scope_trace",
]
evidence = {}
artifacts = {}
for key in required_keys:
    if key == "workspace_scope_trace":
        payload = {
            "ok": True,
            "failures": [],
            "selected_work_item_id": "wi-1",
            "workflow_scope": {
                "scope_kind": "workflow",
                "selection": {"work_item_id": None, "task_id": None},
                "workspace_api": {
                    "selected_scope": {"scope_kind": "workflow", "work_item_id": None, "task_id": None},
                    "live_console": {
                        "brief_ids": [],
                        "execution_turn_ids": [],
                        "execution_turn_items": [],
                        "item_kind_counts": {}
                    },
                    "deliverables": {"all_descriptor_ids": [], "descriptor_kind_counts": {}},
                },
                "db": {"brief_ids": [], "all_descriptor_ids": []},
                "enhanced_live_console": {
                    "applicable": True,
                    "effective_mode": "enhanced",
                    "expected_rows": [],
                    "actual_rows": [],
                    "passed": True,
                    "failures": []
                },
                "reconciliation": {"passed": True, "failures": []},
            },
            "selected_work_item_scope": {
                "scope_kind": "selected_work_item",
                "selection": {"work_item_id": "wi-1", "task_id": None},
                "workspace_api": {
                    "selected_scope": {"scope_kind": "selected_work_item", "work_item_id": "wi-1", "task_id": None},
                    "live_console": {
                        "brief_ids": ["brief-1"],
                        "execution_turn_ids": ["111"],
                        "execution_turn_items": [{"log_id": "111", "item_id": "execution-log:111", "headline": "[Think] Inspect the work item.", "summary": "Inspect the work item.", "task_id": None, "work_item_id": "wi-1"}],
                        "item_kind_counts": {"milestone_brief": 1, "execution_turn": 1}
                    },
                    "deliverables": {"all_descriptor_ids": ["descriptor-1"], "descriptor_kind_counts": {"report": 1}},
                },
                "db": {"brief_ids": ["brief-1"], "all_descriptor_ids": ["descriptor-1"]},
                "enhanced_live_console": {
                    "applicable": True,
                    "effective_mode": "enhanced",
                    "expected_rows": [{"log_id": "111", "operation": "agent.think", "phase": "think", "phase_label": "Think", "surface_expected": True, "surface_kind": "execution_turn", "expected_headline": "[Think] Inspect the work item.", "expected_summary": "Inspect the work item.", "task_id": None, "work_item_id": "wi-1"}],
                    "actual_rows": [{"log_id": "111", "item_id": "execution-log:111", "headline": "[Think] Inspect the work item.", "summary": "Inspect the work item.", "task_id": None, "work_item_id": "wi-1"}],
                    "passed": True,
                    "failures": []
                },
                "reconciliation": {"passed": True, "failures": []},
            },
        }
    else:
        payload = {"ok": True, "key": key}
    path = evidence_dir / f"{key}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    evidence[key] = payload
    artifacts[key] = str(path)
evidence["artifacts"] = artifacts
result_path.write_text(
    json.dumps(
        {
            "scenario_name": "pass",
            "runner_exit_code": 0,
            "workflow_state": "completed",
            "state": "completed",
            "verification_passed": True,
            "verification": {"passed": True, "failures": []},
            "harness_failure": False,
            "outcome_metrics": {"status": "passed"},
            "evidence": evidence,
        }
    ),
    encoding="utf-8",
)
PY

  cat >"${temp_root}/results/incomplete/workflow-run.json" <<'EOF'
{"scenario_name":"incomplete","verification_passed":true}
EOF

  cat >"${temp_root}/scripts/scenario-runner.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(basename "$1" .json)" >>"${LIVE_TEST_BATCH_INVOCATIONS_FILE}"
EOF
  chmod +x "${temp_root}/scripts/scenario-runner.sh"

  LIVE_TEST_ENV_FILE="${temp_root}/env/local.env" \
    LIVE_TEST_SCENARIO_ROOT="${temp_root}/scenarios" \
    LIVE_TEST_TRACKER_FILE="${temp_root}/tracker.json" \
    LIVE_TEST_ARTIFACTS_DIR="${temp_root}/results" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${temp_root}/scripts/shared-bootstrap.sh" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${temp_root}/scripts/bootstrap.sh" \
    LIVE_TEST_SCENARIO_RUNNER="${temp_root}/scripts/scenario-runner.sh" \
    LIVE_TEST_BATCH_INVOCATIONS_FILE="${temp_root}/batch-invocations.txt" \
    "${RUN_BATCH_SCRIPT}" --failed-only

  if grep -Fxq "pass" "${temp_root}/batch-invocations.txt"; then
    echo "did not expect passing scenario to rerun with --failed-only" >&2
    exit 1
  fi

  grep -Fxq "missing" "${temp_root}/batch-invocations.txt"
  grep -Fxq "incomplete" "${temp_root}/batch-invocations.txt"
}

test_run_live_scenario_marks_incomplete_result_as_harness_failure
test_run_live_scenario_clears_stale_evidence_and_fails_when_runner_emits_no_result
test_batch_failed_only_reruns_missing_and_incomplete_results
