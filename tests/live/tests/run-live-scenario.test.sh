#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/scenarios/run-live-scenario.sh"
SCENARIO_NAME="sdlc-assessment-approve"
SCENARIO_PROFILE="sdlc-single-assessment"
SCENARIO_STORAGE_TYPE="git_remote"
SCENARIO_FILE="${ROOT_DIR}/tests/live/scenarios/${SCENARIO_NAME}.json"

fail() {
  echo "[tests/live/run-live-scenario.test] $*" >&2
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

test_scenario_profile_is_exported_to_bootstrap() {
  local tmpdir stubdir logfile stdout_log output_root context_file run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  stdout_log="${tmpdir}/stdout.log"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/${SCENARIO_NAME}/workflow-run.json"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
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
printf "bootstrap LIVE_TEST_PROFILE=%s LIVE_TEST_WORKSPACE_STORAGE_TYPE=%s LIVE_TEST_SCENARIO_FILE=%s LIVE_TEST_SCENARIO_NAME=%s\n" "${LIVE_TEST_PROFILE:-}" "${LIVE_TEST_WORKSPACE_STORAGE_TYPE:-}" "${LIVE_TEST_SCENARIO_FILE:-}" "${LIVE_TEST_SCENARIO_NAME:-}" >>"'"${logfile}"'"
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" "if [[ \"\${1:-}\" == \"-\" ]]; then printf \"%s\\n\" \"${SCENARIO_PROFILE}\" \"${SCENARIO_STORAGE_TYPE}\"; else printf \"%s\\n\" \"{\\\"workflow_id\\\":\\\"workflow-1\\\",\\\"state\\\":\\\"active\\\"}\"; fi"

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${stdout_log}"; then
    :
  fi

  assert_contains "bootstrap LIVE_TEST_PROFILE=${SCENARIO_PROFILE} LIVE_TEST_WORKSPACE_STORAGE_TYPE=${SCENARIO_STORAGE_TYPE} LIVE_TEST_SCENARIO_FILE=${SCENARIO_FILE} LIVE_TEST_SCENARIO_NAME=${SCENARIO_NAME}" "${logfile}"
  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
}

test_runner_failure_promotes_nonzero_json_result() {
  local tmpdir stubdir output_root context_file run_file tmp_run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/${SCENARIO_NAME}/workflow-run.json"
  tmp_run_file="${run_file}.tmp"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
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
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" "if [[ \"\${1:-}\" == \"-\" ]]; then printf \"%s\\n\" \"${SCENARIO_PROFILE}\" \"${SCENARIO_STORAGE_TYPE}\"; else printf \"%s\" \"{\\\"workflow_id\\\":\\\"workflow-1\\\"}\"; exit 1; fi"

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${tmpdir}/stdout.log" 2>"${tmpdir}/stderr.log"; then
    fail "expected scenario runner failure to propagate"
  fi

  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
  if [[ -e "${tmp_run_file}" ]]; then
    fail "expected finalized failing scenario runner to consume ${tmp_run_file}"
  fi
}

test_runner_direct_result_file_is_promoted_on_failure() {
  local tmpdir stubdir output_root context_file run_file tmp_run_file bootstrap_stub envfile runner_script
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/${SCENARIO_NAME}/workflow-run.json"
  tmp_run_file="${run_file}.tmp"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
  runner_script="${tmpdir}/runner.py"
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
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  cat >"${runner_script}" <<'PY'
#!/usr/bin/env python3
from pathlib import Path
import os

Path(os.environ["LIVE_TEST_SCENARIO_RUN_TMP_FILE"]).write_text(
    "{\"workflow_id\":\"workflow-1\",\"verification\":{\"passed\":false}}",
    encoding="utf-8",
)
raise SystemExit(1)
PY
  chmod +x "${runner_script}"

  make_stub "${stubdir}/python3" '
if [[ "${1:-}" == "-" ]]; then
  printf "%s\n" "'"${SCENARIO_PROFILE}"'" "'"${SCENARIO_STORAGE_TYPE}"'"
else
  exec /usr/bin/python3 "$@"
fi'

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_START_WORKFLOW_SCRIPT="${runner_script}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${tmpdir}/stdout.log" 2>"${tmpdir}/stderr.log"; then
    fail "expected direct-write scenario runner failure to propagate"
  fi

  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
  if [[ -e "${tmp_run_file}" ]]; then
    fail "expected finalized direct-write scenario runner to consume ${tmp_run_file}"
  fi
}

test_bootstrap_failure_publishes_harness_failure_result() {
  local tmpdir stubdir output_root run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  run_file="${output_root}/${SCENARIO_NAME}/workflow-run.json"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
  mkdir -p "${stubdir}" "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${bootstrap_stub}" 'exit 1'
  make_stub "${stubdir}/python3" "printf \"%s\\n\" \"${SCENARIO_PROFILE}\" \"${SCENARIO_STORAGE_TYPE}\""

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${tmpdir}/stdout.log" 2>"${tmpdir}/stderr.log"; then
    fail "expected bootstrap failure to propagate"
  fi

  assert_contains "\"harness_failure\": true" "${run_file}"
  assert_contains "\"phase\": \"bootstrap\"" "${run_file}"
  assert_contains "\"exit_code\": 1" "${run_file}"
}

test_bootstrap_can_delete_scenario_dir_without_breaking_runner() {
  local tmpdir stubdir output_root context_file run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/${SCENARIO_NAME}/workflow-run.json"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
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
'rm -rf "${LIVE_TEST_ARTIFACTS_DIR}/${LIVE_TEST_SCENARIO_NAME}"
mkdir -p "$(dirname "${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}")"
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" "if [[ \"\${1:-}\" == \"-\" ]]; then printf \"%s\\n\" \"${SCENARIO_PROFILE}\" \"${SCENARIO_STORAGE_TYPE}\"; else printf \"%s\\n\" \"{\\\"workflow_id\\\":\\\"workflow-1\\\",\\\"state\\\":\\\"active\\\"}\"; fi"

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${tmpdir}/stdout.log"

  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
}

test_runner_resets_stale_trace_before_each_run() {
  local tmpdir stubdir output_root context_file trace_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  trace_file="${output_root}/${SCENARIO_NAME}/trace/api.ndjson"
  bootstrap_stub="${tmpdir}/bootstrap-stub.sh"
  mkdir -p "${stubdir}" "$(dirname "${context_file}")" "$(dirname "${envfile}")" "$(dirname "${trace_file}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  printf 'stale-trace\n' >"${trace_file}"

  make_stub "${bootstrap_stub}" \
'mkdir -p "$(dirname "${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}")"
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" "if [[ \"\${1:-}\" == \"-\" ]]; then printf \"%s\\n\" \"${SCENARIO_PROFILE}\" \"${SCENARIO_STORAGE_TYPE}\"; else printf \"%s\\n\" \"{\\\"workflow_id\\\":\\\"workflow-1\\\",\\\"state\\\":\\\"active\\\"}\"; fi"

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "${SCENARIO_NAME}" >"${tmpdir}/stdout.log"

  if [[ -e "${trace_file}" ]] && grep -Fq "stale-trace" "${trace_file}"; then
    fail "expected stale trace file to be removed before run"
  fi
}

test_scenario_profile_is_exported_to_bootstrap
test_runner_failure_promotes_nonzero_json_result
test_runner_direct_result_file_is_promoted_on_failure
test_bootstrap_failure_publishes_harness_failure_result
test_bootstrap_can_delete_scenario_dir_without_breaking_runner
test_runner_resets_stale_trace_before_each_run

echo "[tests/live/run-live-scenario.test] PASS"
