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

probe_live_test_http() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error "${url}" >/dev/null
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "${url}" >/dev/null
    return $?
  fi
  return 1
}

shared_bootstrap_matches_requested_config() {
  local context_file="$1"

  python3 - "${context_file}" <<'PY'
import json
import os
import sys
from pathlib import Path

context_path = Path(sys.argv[1])
if not context_path.exists():
    raise SystemExit(1)

try:
    context = json.loads(context_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(1)

expected = {
    "provider_auth_mode": os.environ.get("LIVE_TEST_PROVIDER_AUTH_MODE", "oauth").strip() or "oauth",
    "provider_name": os.environ.get("LIVE_TEST_PROVIDER_NAME", "OpenAI (Subscription)").strip() or "OpenAI (Subscription)",
    "provider_type": os.environ.get("LIVE_TEST_PROVIDER_TYPE", "openai").strip() or "openai",
    "model_name": os.environ.get("LIVE_TEST_MODEL_ID", "gpt-5.4-mini").strip() or "gpt-5.4-mini",
    "system_reasoning": os.environ.get("LIVE_TEST_SYSTEM_REASONING_EFFORT", "medium").strip() or "medium",
    "orchestrator_model_name": os.environ.get("LIVE_TEST_ORCHESTRATOR_MODEL_ID", os.environ.get("LIVE_TEST_MODEL_ID", "gpt-5.4-mini")).strip() or "gpt-5.4-mini",
    "orchestrator_reasoning": os.environ.get("LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT", "medium").strip() or "medium",
    "specialist_model_name": os.environ.get("LIVE_TEST_SPECIALIST_MODEL_ID", "gpt-5.4-mini").strip() or "gpt-5.4-mini",
    "specialist_reasoning": os.environ.get("LIVE_TEST_SPECIALIST_REASONING_EFFORT", "medium").strip() or "medium",
}

actual = {key: context.get(key) for key in expected}
raise SystemExit(0 if actual == expected else 1)
PY
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
LIVE_TEST_ARTIFACTS_DIR="${LIVE_TEST_ARTIFACTS_DIR:-${REPO_ROOT}/.tmp/live-tests}"
LIVE_TEST_SHARED_CONTEXT_FILE="${LIVE_TEST_SHARED_CONTEXT_FILE:-${LIVE_TEST_ARTIFACTS_DIR}/bootstrap/context.json}"
LIVE_TEST_SCENARIO_DIR="${LIVE_TEST_SCENARIO_DIR:-${LIVE_TEST_ARTIFACTS_DIR}/${LIVE_TEST_SCENARIO_NAME}}"
LIVE_TEST_SCENARIO_TRACE_DIR="${LIVE_TEST_SCENARIO_TRACE_DIR:-${LIVE_TEST_SCENARIO_DIR}/trace}"
LIVE_TEST_RUN_CONTEXT_FILE="${LIVE_TEST_RUN_CONTEXT_FILE:-${LIVE_TEST_SCENARIO_DIR}/run-context.json}"
LIVE_TEST_SCENARIO_RUN_FILE="${LIVE_TEST_SCENARIO_RUN_FILE:-${LIVE_TEST_SCENARIO_DIR}/workflow-run.json}"
LIVE_TEST_BOOTSTRAP_CONTEXT_FILE="${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE:-${LIVE_TEST_RUN_CONTEXT_FILE}}"
LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/prepare-live-test-shared-environment.sh}"
LIVE_TEST_BOOTSTRAP_SCRIPT="${LIVE_TEST_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/prepare-live-test-run.sh}"
LIVE_TEST_START_WORKFLOW_SCRIPT="${LIVE_TEST_START_WORKFLOW_SCRIPT:-${LIVE_TEST_ROOT}/lib/run_workflow_scenario.py}"
LIVE_TEST_SCENARIO_RUN_TMP_FILE="${LIVE_TEST_SCENARIO_RUN_TMP_FILE:-${LIVE_TEST_SCENARIO_RUN_FILE}.tmp}"
LIVE_TEST_SCENARIO_RUN_STDOUT_FILE="${LIVE_TEST_SCENARIO_RUN_STDOUT_FILE:-${LIVE_TEST_SCENARIO_RUN_TMP_FILE}.stdout}"
LIVE_TEST_RUN_PHASE="bootstrap"

trap 'status=$?; trap - EXIT; finalize_live_test_result "${status}"; exit "${status}"' EXIT

load_live_test_env "${LIVE_TEST_ENV_FILE}"
PLATFORM_API_BASE_URL="${PLATFORM_API_BASE_URL:-http://127.0.0.1:${PLATFORM_API_PORT:-8080}}"
require_live_test_value "DEFAULT_ADMIN_API_KEY" "${DEFAULT_ADMIN_API_KEY:-}"

mkdir -p "${LIVE_TEST_SCENARIO_DIR}" "${LIVE_TEST_SCENARIO_TRACE_DIR}"
rm -rf "${LIVE_TEST_SCENARIO_TRACE_DIR}"

export LIVE_TEST_ARTIFACTS_DIR
export LIVE_TEST_SHARED_CONTEXT_FILE
export LIVE_TEST_PROFILE
export LIVE_TEST_WORKSPACE_STORAGE_TYPE
export LIVE_TEST_SCENARIO_FILE
export LIVE_TEST_SCENARIO_NAME
if [[ ! -f "${LIVE_TEST_SHARED_CONTEXT_FILE}" ]] \
  || ! probe_live_test_http "${PLATFORM_API_BASE_URL}/health" \
  || ! shared_bootstrap_matches_requested_config "${LIVE_TEST_SHARED_CONTEXT_FILE}"; then
  "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}"
fi

export LIVE_TEST_RUN_CONTEXT_FILE
export LIVE_TEST_BOOTSTRAP_CONTEXT_FILE
"${LIVE_TEST_BOOTSTRAP_SCRIPT}"

export LIVE_TEST_BOOTSTRAP_CONTEXT_FILE
export LIVE_TEST_SCENARIO_TRACE_DIR
export PLATFORM_API_BASE_URL
export DEFAULT_ADMIN_API_KEY
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

LIVE_TEST_RUN_PHASE="complete"
if (( runner_status != 0 )); then
  exit "${runner_status}"
fi

log_live_test "scenario result written to ${LIVE_TEST_SCENARIO_RUN_FILE}"
