#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/scenarios/run-multi-orchestrator-concurrent-assessment-workflows-live-test.sh"

fail() {
  echo "[tests/live/run-multi-orchestrator-concurrent-assessment-workflows-live-test.test] $*" >&2
  exit 1
}

make_stub() {
  local path="$1"
  local body="$2"
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' "${body}" >"${path}"
  chmod +x "${path}"
}

test_multi_orchestrator_script_passes_when_child_runs_use_two_runtime_actors() {
  local tmpdir envfile bootstrap_stub runner_stub artifacts_dir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  bootstrap_stub="${tmpdir}/bootstrap.sh"
  runner_stub="${tmpdir}/runner.sh"
  artifacts_dir="${tmpdir}/artifacts"
  mkdir -p "$(dirname "${envfile}")" "${artifacts_dir}"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${bootstrap_stub}" ':'
  make_stub "${runner_stub}" '
scenario_path="$1"
scenario="$(basename "${scenario_path%.json}")"
artifacts_dir="${LIVE_TEST_ARTIFACTS_DIR:?}"
mkdir -p "${artifacts_dir}/${scenario}"
actor="orch-a"
if [[ "${scenario}" == *"-02" ]]; then
  actor="orch-b"
fi
cat >"${artifacts_dir}/${scenario}/workflow-run.json" <<JSON
{
  "workflow_id": "${scenario}-wf",
  "runner_exit_code": 0,
  "workflow_state": "completed",
  "verification_passed": true,
  "verification": {"passed": true, "failures": [], "advisories": []},
  "outcome_metrics": {
    "agentic_effort": {
      "input_token_count": 10,
      "output_token_count": 5,
      "total_token_count": 15,
      "total_loop_count": 2,
      "orchestrator_loop_count": 1,
      "specialist_loop_count": 1
    },
    "orchestrator_distribution": {
      "distinct_runtime_count": 1,
      "runtime_actors": ["${actor}"]
    }
  },
  "evidence": {
    "db_state": {"tasks": [], "work_items": []},
    "http_status_summary": {"count": 0, "rows": [], "status_counts": {}, "client_error_count": 0, "server_error_count": 0},
    "log_anomalies": {"count": 0, "rows": []},
    "runtime_cleanup": {"all_clean": true, "runtime_containers": []}
  }
}
JSON
'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${artifacts_dir}" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_MULTI_ORCH_SCENARIO_RUNNER="${runner_stub}" \
    LIVE_TEST_MULTI_ORCH_WORKFLOW_COUNT=3 \
    "${SCRIPT_PATH}"

  python3 - <<PY
import json
from pathlib import Path
payload = json.loads(Path("${artifacts_dir}/multi-orchestrator-concurrent-assessment-workflows/workflow-run.json").read_text())
assert payload["verification_passed"] is True
assert payload["runner_exit_code"] == 0
assert payload["outcome_metrics"]["orchestrator_distribution"]["distinct_runtime_count"] == 2
PY
}

test_multi_orchestrator_script_fails_when_only_one_runtime_actor_is_used() {
  local tmpdir envfile bootstrap_stub runner_stub artifacts_dir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  bootstrap_stub="${tmpdir}/bootstrap.sh"
  runner_stub="${tmpdir}/runner.sh"
  artifacts_dir="${tmpdir}/artifacts"
  mkdir -p "$(dirname "${envfile}")" "${artifacts_dir}"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${bootstrap_stub}" ':'
  make_stub "${runner_stub}" '
scenario_path="$1"
scenario="$(basename "${scenario_path%.json}")"
artifacts_dir="${LIVE_TEST_ARTIFACTS_DIR:?}"
mkdir -p "${artifacts_dir}/${scenario}"
cat >"${artifacts_dir}/${scenario}/workflow-run.json" <<JSON
{
  "workflow_id": "${scenario}-wf",
  "runner_exit_code": 0,
  "workflow_state": "completed",
  "verification_passed": true,
  "verification": {"passed": true, "failures": [], "advisories": []},
  "outcome_metrics": {
    "agentic_effort": {
      "input_token_count": 10,
      "output_token_count": 5,
      "total_token_count": 15,
      "total_loop_count": 2,
      "orchestrator_loop_count": 1,
      "specialist_loop_count": 1
    },
    "orchestrator_distribution": {
      "distinct_runtime_count": 1,
      "runtime_actors": ["orch-a"]
    }
  },
  "evidence": {
    "db_state": {"tasks": [], "work_items": []},
    "http_status_summary": {"count": 0, "rows": [], "status_counts": {}, "client_error_count": 0, "server_error_count": 0},
    "log_anomalies": {"count": 0, "rows": []},
    "runtime_cleanup": {"all_clean": true, "runtime_containers": []}
  }
}
JSON
'

  if LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${artifacts_dir}" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_MULTI_ORCH_SCENARIO_RUNNER="${runner_stub}" \
    LIVE_TEST_MULTI_ORCH_WORKFLOW_COUNT=3 \
    "${SCRIPT_PATH}"; then
    fail "expected script to fail when only one orchestrator actor is used"
  fi

  python3 - <<PY
import json
from pathlib import Path
payload = json.loads(Path("${artifacts_dir}/multi-orchestrator-concurrent-assessment-workflows/workflow-run.json").read_text())
assert payload["verification_passed"] is False
assert payload["runner_exit_code"] == 1
assert any("at least 2 distinct orchestrator runtime actors" in item for item in payload["verification"]["failures"])
PY
}

test_multi_orchestrator_script_passes_when_child_runs_use_two_runtime_actors
test_multi_orchestrator_script_fails_when_only_one_runtime_actor_is_used
