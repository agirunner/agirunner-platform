#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/scenarios/run-sdlc-baseline-live-test.sh"

fail() {
  echo "[tests/live/run-sdlc-baseline-live-test.test] $*" >&2
  exit 1
}

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "--- ${file} ---" >&2
    cat "$file" >&2
    fail "expected to find: ${needle}"
  fi
}

make_stub() {
  local path="$1"
  local body="$2"
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' "${body}" >"${path}"
  chmod +x "${path}"
}

test_scenario_runs_bootstrap_and_records_launch_output() {
  local tmpdir stubdir logfile stdout_log output_root context_file run_file bootstrap_stub start_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  stdout_log="${tmpdir}/stdout.log"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/sdlc-baseline/workflow-run.json"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
  start_stub="${tmpdir}/start-workflow-stub.py"
  mkdir -p "${stubdir}" "$(dirname "${context_file}")" "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${bootstrap_stub}" \
'mkdir -p "$(dirname "${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}")"
printf "bootstrap LIVE_TEST_ARTIFACTS_DIR=%s LIVE_TEST_BOOTSTRAP_CONTEXT_FILE=%s\n" "${LIVE_TEST_ARTIFACTS_DIR:-}" "${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE:-}" >>"'"${logfile}"'"
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" 'printf "python3 %s\n" "$*" >>"'"${logfile}"'"; printf "python3 LIVE_TEST_BOOTSTRAP_CONTEXT_FILE=%s LIVE_TEST_SCENARIO_NAME=%s LIVE_TEST_WORKFLOW_NAME=%s LIVE_TEST_WORKFLOW_GOAL=%s LIVE_TEST_SCENARIO_TRACE_DIR=%s PLATFORM_API_BASE_URL=%s DEFAULT_ADMIN_API_KEY=%s\n" "${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE:-}" "${LIVE_TEST_SCENARIO_NAME:-}" "${LIVE_TEST_WORKFLOW_NAME:-}" "${LIVE_TEST_WORKFLOW_GOAL:-}" "${LIVE_TEST_SCENARIO_TRACE_DIR:-}" "${PLATFORM_API_BASE_URL:-}" "${DEFAULT_ADMIN_API_KEY:-}" >>"'"${logfile}"'"; printf "%s\n" "{\"workflow_id\":\"workflow-1\",\"state\":\"active\"}"'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_START_WORKFLOW_SCRIPT="${start_stub}" \
    "${SCRIPT_PATH}" >"${stdout_log}"

  assert_contains "bootstrap LIVE_TEST_ARTIFACTS_DIR=${output_root} LIVE_TEST_BOOTSTRAP_CONTEXT_FILE=${context_file}" "${logfile}"
  assert_contains "python3 ${start_stub}" "${logfile}"
  assert_contains "python3 LIVE_TEST_BOOTSTRAP_CONTEXT_FILE=${context_file} LIVE_TEST_SCENARIO_NAME=sdlc-baseline LIVE_TEST_WORKFLOW_NAME=SDLC Baseline Proof LIVE_TEST_WORKFLOW_GOAL=Add support for named greetings and uppercase output while preserving the default greeting, with updated docs and regression tests. LIVE_TEST_SCENARIO_TRACE_DIR=${output_root}/sdlc-baseline/trace PLATFORM_API_BASE_URL=http://127.0.0.1:8080 DEFAULT_ADMIN_API_KEY=test-admin-key" "${logfile}"
  assert_contains "[tests/live] scenario result written to ${run_file}" "${stdout_log}"
  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
}

test_scenario_runs_bootstrap_and_records_launch_output

echo "[tests/live/run-sdlc-baseline-live-test.test] PASS"
