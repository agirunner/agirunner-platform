#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/scenarios/run-live-scenario.sh"

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
  run_file="${output_root}/bug-fix-positive/workflow-run.json"
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
printf "bootstrap LIVE_TEST_PROFILE=%s LIVE_TEST_SCENARIO_FILE=%s LIVE_TEST_SCENARIO_NAME=%s\n" "${LIVE_TEST_PROFILE:-}" "${LIVE_TEST_SCENARIO_FILE:-}" "${LIVE_TEST_SCENARIO_NAME:-}" >>"'"${logfile}"'"
printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"workspace-one\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\",\"playbook_id\":\"playbook-1\"}" >"${LIVE_TEST_BOOTSTRAP_CONTEXT_FILE}"'

  make_stub "${stubdir}/python3" 'if [[ "${1:-}" == "-" ]]; then printf "%s\n" "bug-fix"; else printf "%s\n" "{\"workflow_id\":\"workflow-1\",\"state\":\"active\"}"; fi'

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "bug-fix-positive" >"${stdout_log}"; then
    :
  fi

  assert_contains "bootstrap LIVE_TEST_PROFILE=bug-fix LIVE_TEST_SCENARIO_FILE=${ROOT_DIR}/tests/live/scenarios/bug-fix-positive.json LIVE_TEST_SCENARIO_NAME=bug-fix-positive" "${logfile}"
  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
}

test_runner_failure_does_not_publish_partial_workflow_result() {
  local tmpdir stubdir output_root context_file run_file tmp_run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/bug-fix-positive/workflow-run.json"
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

  make_stub "${stubdir}/python3" 'if [[ "${1:-}" == "-" ]]; then printf "%s\n" "bug-fix"; else printf "%s" "{\"workflow_id\":\"workflow-1\"}"; exit 1; fi'

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "bug-fix-positive" >"${tmpdir}/stdout.log" 2>"${tmpdir}/stderr.log"; then
    fail "expected scenario runner failure to propagate"
  fi

  if [[ -e "${run_file}" ]]; then
    fail "expected failing scenario runner to avoid publishing ${run_file}"
  fi

  if [[ ! -s "${tmp_run_file}" ]]; then
    fail "expected failing scenario runner to preserve non-empty temp output for debugging"
  fi
}

test_bootstrap_can_delete_scenario_dir_without_breaking_runner() {
  local tmpdir stubdir output_root context_file run_file bootstrap_stub envfile
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  context_file="${output_root}/bootstrap/context.json"
  run_file="${output_root}/bug-fix-positive/workflow-run.json"
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

  make_stub "${stubdir}/python3" 'if [[ "${1:-}" == "-" ]]; then printf "%s\n" "bug-fix"; else printf "%s\n" "{\"workflow_id\":\"workflow-1\",\"state\":\"active\"}"; fi'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" "bug-fix-positive" >"${tmpdir}/stdout.log"

  assert_contains "\"workflow_id\":\"workflow-1\"" "${run_file}"
}

test_scenario_profile_is_exported_to_bootstrap
test_runner_failure_does_not_publish_partial_workflow_result
test_bootstrap_can_delete_scenario_dir_without_breaking_runner

echo "[tests/live/run-live-scenario.test] PASS"
