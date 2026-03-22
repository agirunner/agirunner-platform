#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/scenarios/run-live-scenario-batch.sh"

fail() {
  echo "[tests/live/run-live-scenario-batch.test] $*" >&2
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

test_batch_runner_uses_default_concurrency_and_reports_results_as_completed() {
  local tmpdir bootstrap_stub runner_stub output_log envfile scenario_dir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  output_log="${tmpdir}/output.log"
  envfile="${tmpdir}/env/local.env"
  bootstrap_stub="${tmpdir}/bootstrap.sh"
  runner_stub="${tmpdir}/runner.sh"
  scenario_dir="${tmpdir}/scenarios"
  mkdir -p "${scenario_dir}" "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  printf '%s\n' '{}' >"${scenario_dir}/alpha.json"
  printf '%s\n' '{}' >"${scenario_dir}/beta.json"

  make_stub "${bootstrap_stub}" 'printf "[bootstrap] shared\n"'
  cat >"${runner_stub}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
scenario="$1"
if [[ "${scenario}" == "alpha" ]]; then
  sleep 0.2
  exit 0
fi
sleep 0.1
exit 1
EOF
  chmod +x "${runner_stub}"

  if LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_SCENARIO_DIR="${scenario_dir}" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_SCENARIO_RUNNER="${runner_stub}" \
    "${SCRIPT_PATH}" >"${output_log}" 2>&1; then
    fail "expected mixed batch results to return nonzero"
  fi

  assert_contains "Running live scenarios with concurrency=5" "${output_log}"
  assert_contains "[bootstrap] shared" "${output_log}"
  assert_contains "FAIL beta" "${output_log}"
  assert_contains "PASS alpha" "${output_log}"
  assert_contains "Completed 2 scenario(s): 1 passed, 1 failed" "${output_log}"
  assert_contains "Matrix status: 0 passed, 2 remaining, 2 total" "${output_log}"
}

test_batch_runner_uses_explicit_concurrency_argument() {
  local tmpdir bootstrap_stub runner_stub output_log envfile scenario_dir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  output_log="${tmpdir}/output.log"
  envfile="${tmpdir}/env/local.env"
  bootstrap_stub="${tmpdir}/bootstrap.sh"
  runner_stub="${tmpdir}/runner.sh"
  scenario_dir="${tmpdir}/scenarios"
  mkdir -p "${scenario_dir}" "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  printf '%s\n' '{}' >"${scenario_dir}/alpha.json"
  make_stub "${bootstrap_stub}" ':'
  cat >"${runner_stub}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
scenario="$1"
artifacts_dir="${LIVE_TEST_ARTIFACTS_DIR:?}"
mkdir -p "${artifacts_dir}/${scenario}"
cat >"${artifacts_dir}/${scenario}/workflow-run.json" <<'JSON'
{"verification_passed":true}
JSON
EOF
  chmod +x "${runner_stub}"

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_SCENARIO_DIR="${scenario_dir}" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    LIVE_TEST_SCENARIO_RUNNER="${runner_stub}" \
    "${SCRIPT_PATH}" 3 >"${output_log}" 2>&1

  assert_contains "Running live scenarios with concurrency=3" "${output_log}"
  assert_contains "Matrix status: 1 passed, 0 remaining, 1 total" "${output_log}"
}

test_batch_runner_uses_default_concurrency_and_reports_results_as_completed
test_batch_runner_uses_explicit_concurrency_argument
