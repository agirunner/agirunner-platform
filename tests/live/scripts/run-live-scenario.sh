#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${LIVE_TEST_ROOT}/../.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

finalize_live_test_result() {
  local exit_code="$1"

  if [[ -f "${LIVE_TEST_SCENARIO_RUN_FILE}" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "${LIVE_TEST_SCENARIO_RUN_FILE}")"

  if [[ -s "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" ]]; then
    mv "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" "${LIVE_TEST_SCENARIO_RUN_FILE}"
    return 0
  fi

  cat >"${LIVE_TEST_SCENARIO_RUN_FILE}" <<EOF
{
  "scenario_name": "$(json_escape "${LIVE_TEST_SCENARIO_NAME}")",
  "harness_failure": true,
  "verification": {
    "passed": false,
    "failures": [
      "Harness failed before emitting a finalized workflow result."
    ]
  },
  "harness": {
    "phase": "$(json_escape "${LIVE_TEST_RUN_PHASE:-unknown}")",
    "exit_code": ${exit_code},
    "result_file": "$(json_escape "${LIVE_TEST_SCENARIO_RUN_FILE}")",
    "tmp_result_file": "$(json_escape "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}")"
  }
}
EOF
}

validate_live_test_result_json() {
  python3 "${LIVE_TEST_RESULT_VALIDATOR}" validate "${LIVE_TEST_SCENARIO_RUN_FILE}"
}

write_harness_failure_result() {
  local exit_code="$1"
  local invalid_result_file="${2:-}"
  local failures_json

  shift 2 || true
  failures_json="$(python3 - "$@" <<'PY'
import json
import sys

print(json.dumps(sys.argv[1:]))
PY
)"

  mkdir -p "$(dirname "${LIVE_TEST_SCENARIO_RUN_FILE}")"
  cat >"${LIVE_TEST_SCENARIO_RUN_FILE}" <<EOF
{
  "scenario_name": "$(json_escape "${LIVE_TEST_SCENARIO_NAME}")",
  "harness_failure": true,
  "verification": {
    "passed": false,
    "failures": ${failures_json}
  },
  "harness": {
    "phase": "$(json_escape "${LIVE_TEST_RUN_PHASE:-unknown}")",
    "exit_code": ${exit_code},
    "result_file": "$(json_escape "${LIVE_TEST_SCENARIO_RUN_FILE}")",
    "tmp_result_file": "$(json_escape "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}")",
    "invalid_result_file": "$(json_escape "${invalid_result_file}")"
  }
}
EOF
}

fail_loud_on_incomplete_result() {
  local validation_json
  local validation_file
  local invalid_result_file=""
  local -a validation_failures=()

  validation_json="$(validate_live_test_result_json)"
  if python3 - "${validation_json}" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
raise SystemExit(0 if payload.get("is_valid") and payload.get("is_passing") else 1)
PY
  then
    return 0
  fi

  validation_file="${LIVE_TEST_SCENARIO_DIR}/workflow-run.validation.json"
  printf '%s\n' "${validation_json}" >"${validation_file}"

  if [[ -f "${LIVE_TEST_SCENARIO_RUN_FILE}" ]]; then
    invalid_result_file="${LIVE_TEST_SCENARIO_DIR}/workflow-run.incomplete.json"
    cp "${LIVE_TEST_SCENARIO_RUN_FILE}" "${invalid_result_file}"
  fi

  mapfile -t validation_failures < <(
    python3 - "${validation_json}" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
for failure in payload.get("failures", []):
    print(str(failure))
PY
  )

  rm -f "${LIVE_TEST_SCENARIO_RUN_FILE}"
  write_harness_failure_result 1 "${invalid_result_file}" "${validation_failures[@]}"
  return 1
}

require_live_test_shared_bootstrap() {
  local shared_bootstrap_script="$1"
  local shared_context_file="$2"
  local platform_api_base_url="$3"
  local remote_mcp_fixture_url="$4"
  local runtime_repo_root="${RUNTIME_REPO_PATH:-${REPO_ROOT}/../agirunner-runtime}"

  if [[ -z "${LIVE_TEST_SHARED_BOOTSTRAP_KEY:-}" ]]; then
    ensure_live_test_shared_bootstrap \
      "${shared_bootstrap_script}" \
      "${shared_context_file}" \
      "${platform_api_base_url}" \
      "${remote_mcp_fixture_url}" \
      "${LIVE_TEST_ROOT}" \
      "${REPO_ROOT}" \
      "${runtime_repo_root}"
    return 0
  fi

  require_live_test_file "${shared_context_file}" "shared live test context file"
  if ! shared_live_test_context_has_bootstrap_key "${shared_context_file}" "${LIVE_TEST_SHARED_BOOTSTRAP_KEY}"; then
    echo "[tests/live] shared live test context key does not match the requested bootstrap key" >&2
    exit 1
  fi
}

SCENARIO_INPUT="${1:-${LIVE_TEST_SCENARIO_NAME:-}}"
if [[ -z "${SCENARIO_INPUT}" ]]; then
  echo "[tests/live] scenario name or path is required" >&2
  exit 1
fi

if [[ -f "${SCENARIO_INPUT}" ]]; then
  LIVE_TEST_SCENARIO_FILE="$(cd "$(dirname "${SCENARIO_INPUT}")" && pwd)/$(basename "${SCENARIO_INPUT}")"
else
  LIVE_TEST_SCENARIO_FILE="${LIVE_TEST_ROOT}/scenarios/${SCENARIO_INPUT}.json"
fi

require_live_test_file "${LIVE_TEST_SCENARIO_FILE}" "live test scenario file"

log_scenario_status() {
  if [[ "${LIVE_TEST_QUIET_STATUS:-false}" == "true" ]]; then
    return 0
  fi
  log_live_test "$@"
}

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
LIVE_TEST_SCENARIO_NAME="${LIVE_TEST_SCENARIO_NAME:-$(basename "${LIVE_TEST_SCENARIO_FILE}" .json)}"
if [[ -z "${LIVE_TEST_PROFILE:-}" || -z "${LIVE_TEST_WORKSPACE_STORAGE_TYPE:-}" ]]; then
  mapfile -t LIVE_TEST_SCENARIO_METADATA < <(
    python3 - "${LIVE_TEST_ROOT}/lib" "${LIVE_TEST_SCENARIO_FILE}" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from scenario_config import load_scenario

scenario = load_scenario(Path(sys.argv[2]))
print(scenario["profile"])
print(scenario["workspace"]["storage"]["type"])
PY
  )
fi
LIVE_TEST_PROFILE="${LIVE_TEST_PROFILE:-${LIVE_TEST_SCENARIO_METADATA[0]}}"
LIVE_TEST_WORKSPACE_STORAGE_TYPE="${LIVE_TEST_WORKSPACE_STORAGE_TYPE:-${LIVE_TEST_SCENARIO_METADATA[1]}}"
LIVE_TEST_ARTIFACTS_DIR="${LIVE_TEST_ARTIFACTS_DIR:-$(default_live_test_artifacts_dir)}"
LIVE_TEST_SHARED_CONTEXT_FILE="${LIVE_TEST_SHARED_CONTEXT_FILE:-${LIVE_TEST_ARTIFACTS_DIR}/bootstrap/context.json}"
LIVE_TEST_SCENARIO_DIR="${LIVE_TEST_SCENARIO_DIR:-${LIVE_TEST_ARTIFACTS_DIR}/${LIVE_TEST_SCENARIO_NAME}}"
LIVE_TEST_SCENARIO_TRACE_DIR="${LIVE_TEST_SCENARIO_TRACE_DIR:-${LIVE_TEST_SCENARIO_DIR}/trace}"
LIVE_TEST_RUN_CONTEXT_FILE="${LIVE_TEST_RUN_CONTEXT_FILE:-${LIVE_TEST_SCENARIO_DIR}/run-context.json}"
LIVE_TEST_SCENARIO_RUN_FILE="${LIVE_TEST_SCENARIO_RUN_FILE:-${LIVE_TEST_SCENARIO_DIR}/workflow-run.json}"
LIVE_TEST_BOOTSTRAP_CONTEXT_FILE="${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE:-${LIVE_TEST_RUN_CONTEXT_FILE}}"
LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/scripts/prepare-live-test-shared-environment.sh}"
LIVE_TEST_BOOTSTRAP_SCRIPT="${LIVE_TEST_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/scripts/prepare-live-test-run.sh}"
LIVE_TEST_START_WORKFLOW_SCRIPT="${LIVE_TEST_START_WORKFLOW_SCRIPT:-${LIVE_TEST_ROOT}/lib/run_workflow_scenario.py}"
LIVE_TEST_RESULT_VALIDATOR="${LIVE_TEST_RESULT_VALIDATOR:-${LIVE_TEST_ROOT}/scripts/validate_live_result.py}"
LIVE_TEST_SCENARIO_RUN_TMP_FILE="${LIVE_TEST_SCENARIO_RUN_TMP_FILE:-${LIVE_TEST_SCENARIO_RUN_FILE}.tmp}"
LIVE_TEST_SCENARIO_RUN_STDOUT_FILE="${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE:-${LIVE_TEST_SCENARIO_RUN_TMP_FILE}.stdout}"
LIVE_TEST_RUN_PHASE="bootstrap"

trap 'status=$?; trap - EXIT; finalize_live_test_result "${status}"; exit "${status}"' EXIT

load_live_test_env "${LIVE_TEST_ENV_FILE}"
PLATFORM_API_BASE_URL="${PLATFORM_API_BASE_URL:-http://127.0.0.1:${PLATFORM_API_PORT:-8080}}"
LIVE_TEST_REMOTE_MCP_FIXTURE_URL="${LIVE_TEST_REMOTE_MCP_FIXTURE_URL:-http://127.0.0.1:${LIVE_TEST_REMOTE_MCP_FIXTURE_PORT:-18080}/health}"
require_live_test_value "DEFAULT_ADMIN_API_KEY" "${DEFAULT_ADMIN_API_KEY:-}"
require_live_test_value "PLATFORM_SERVICE_API_KEY" "${PLATFORM_SERVICE_API_KEY:-}"
require_live_test_file "${LIVE_TEST_RESULT_VALIDATOR}" "live test result validator"
log_scenario_status "START ${LIVE_TEST_SCENARIO_NAME}"

rm -rf "${LIVE_TEST_SCENARIO_DIR}"
mkdir -p "${LIVE_TEST_SCENARIO_DIR}" "${LIVE_TEST_SCENARIO_TRACE_DIR}"

export LIVE_TEST_ARTIFACTS_DIR
export LIVE_TEST_SHARED_CONTEXT_FILE
export LIVE_TEST_PROFILE
export LIVE_TEST_WORKSPACE_STORAGE_TYPE
export LIVE_TEST_SCENARIO_FILE
export LIVE_TEST_SCENARIO_NAME
require_live_test_shared_bootstrap \
  "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}" \
  "${LIVE_TEST_SHARED_CONTEXT_FILE}" \
  "${PLATFORM_API_BASE_URL}" \
  "${LIVE_TEST_REMOTE_MCP_FIXTURE_URL}"

export LIVE_TEST_RUN_CONTEXT_FILE
export LIVE_TEST_BOOTSTRAP_CONTEXT_FILE
"${LIVE_TEST_BOOTSTRAP_SCRIPT}"

export LIVE_TEST_BOOTSTRAP_CONTEXT_FILE
export LIVE_TEST_SCENARIO_TRACE_DIR
export PLATFORM_API_BASE_URL
export DEFAULT_ADMIN_API_KEY
export PLATFORM_SERVICE_API_KEY
export LIVE_TEST_SCENARIO_RUN_FILE
export LIVE_TEST_SCENARIO_RUN_TMP_FILE

mkdir -p "${LIVE_TEST_SCENARIO_DIR}" "${LIVE_TEST_SCENARIO_TRACE_DIR}"
rm -f "${LIVE_TEST_SCENARIO_RUN_FILE}" "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" "${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE}"
LIVE_TEST_RUN_PHASE="runner"
set +e
python3 "${LIVE_TEST_START_WORKFLOW_SCRIPT}" >"${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE}"
runner_status=$?
set -e

if [[ ! -s "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" && -s "${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE}" ]]; then
  mv "${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE}" "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}"
else
  rm -f "${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE}"
fi

if [[ -s "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" ]]; then
  mv "${LIVE_TEST_SCENARIO_RUN_TMP_FILE}" "${LIVE_TEST_SCENARIO_RUN_FILE}"
fi

if ! fail_loud_on_incomplete_result; then
  log_scenario_status "FAIL ${LIVE_TEST_SCENARIO_NAME}"
  exit 1
fi

LIVE_TEST_RUN_PHASE="complete"
if (( runner_status != 0 )); then
  log_scenario_status "FAIL ${LIVE_TEST_SCENARIO_NAME}"
  exit "${runner_status}"
fi

log_scenario_status "PASS ${LIVE_TEST_SCENARIO_NAME}"
log_scenario_status "scenario result written to ${LIVE_TEST_SCENARIO_RUN_FILE}"
