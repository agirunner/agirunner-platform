#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/run.sh"

fail() {
  echo "[tests/live/run.test] $*" >&2
  exit 1
}

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "--- ${file} ---" >&2
    cat "${file}" >&2
    fail "expected to find: ${needle}"
  fi
}

assert_not_contains() {
  local needle="$1"
  local file="$2"
  if grep -Fq "$needle" "$file"; then
    echo "--- ${file} ---" >&2
    cat "${file}" >&2
    fail "expected not to find: ${needle}"
  fi
}

make_stub() {
  local path="$1"
  local body="$2"
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' "${body}" >"${path}"
  chmod +x "${path}"
}

test_defaults_to_batch_runner() {
  local tmpdir envfile batch_stub output_log call_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  batch_stub="${tmpdir}/batch.sh"
  output_log="${tmpdir}/stdout.log"
  call_log="${tmpdir}/calls.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${batch_stub}" 'printf "batch %s\n" "$*" >>"'"${call_log}"'"'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_BATCH_RUNNER="${batch_stub}" \
    "${SCRIPT_PATH}" >"${output_log}"

  assert_contains "batch " "${call_log}"
}

test_runs_single_scenario() {
  local tmpdir envfile scenario_stub output_log call_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  scenario_stub="${tmpdir}/scenario.sh"
  output_log="${tmpdir}/stdout.log"
  call_log="${tmpdir}/calls.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${scenario_stub}" 'printf "scenario %s\n" "$*" >>"'"${call_log}"'"'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_SCENARIO_RUNNER="${scenario_stub}" \
    "${SCRIPT_PATH}" --scenario sdlc-assessment-approve >"${output_log}"

  assert_contains "scenario sdlc-assessment-approve" "${call_log}"
}

test_runs_shared_bootstrap_only() {
  local tmpdir envfile bootstrap_stub output_log call_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  bootstrap_stub="${tmpdir}/bootstrap.sh"
  output_log="${tmpdir}/stdout.log"
  call_log="${tmpdir}/calls.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${bootstrap_stub}" 'printf "bootstrap %s\n" "$*" >>"'"${call_log}"'"'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${bootstrap_stub}" \
    "${SCRIPT_PATH}" --bootstrap-only >"${output_log}"

  assert_contains "bootstrap " "${call_log}"
}

test_runs_prepare_only_for_scenario() {
  local tmpdir envfile prepare_stub output_log call_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  prepare_stub="${tmpdir}/prepare.sh"
  output_log="${tmpdir}/stdout.log"
  call_log="${tmpdir}/calls.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${prepare_stub}" 'printf "prepare %s\n" "$*" >>"'"${call_log}"'"'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_BOOTSTRAP_SCRIPT="${prepare_stub}" \
    "${SCRIPT_PATH}" --prepare-only --scenario sdlc-assessment-approve >"${output_log}"

  assert_contains "prepare sdlc-assessment-approve" "${call_log}"
}

test_routes_multi_orchestrator_scenario_to_special_runner() {
  local tmpdir envfile special_stub output_log call_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  special_stub="${tmpdir}/multi-orch.sh"
  output_log="${tmpdir}/stdout.log"
  call_log="${tmpdir}/calls.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  make_stub "${special_stub}" 'printf "multi-orch %s\n" "$*" >>"'"${call_log}"'"'

  LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_MULTI_ORCHESTRATOR_RUNNER="${special_stub}" \
    "${SCRIPT_PATH}" --scenario multi-orchestrator-concurrent-assessment-workflows >"${output_log}"

  assert_contains "multi-orch " "${call_log}"
}

test_normalizes_oauth_session_from_env() {
  local tmpdir envfile output_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  output_log="${tmpdir}/stdout.log"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID=openai-codex
LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON='{"credentials":{"accessToken":"plain-access","authorizedAt":"2026-03-19T00:00:00.000Z"}}'
EOF

  LIVE_TEST_ENV_FILE="${envfile}" \
    "${SCRIPT_PATH}" --normalize-oauth-session >"${output_log}"

  assert_contains '{"credentials":{"accessToken":"plain-access","authorizedAt":"2026-03-19T00:00:00.000Z"}}' "${output_log}"
}

test_writes_normalized_oauth_session_to_file() {
  local tmpdir envfile output_log output_file
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  envfile="${tmpdir}/env/local.env"
  output_log="${tmpdir}/stdout.log"
  output_file="${tmpdir}/snapshots/session.json"
  mkdir -p "$(dirname "${envfile}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID=openai-codex
LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON='{"credentials":{"accessToken":"plain-access","authorizedAt":"2026-03-19T00:00:00.000Z"}}'
EOF

  LIVE_TEST_ENV_FILE="${envfile}" \
    "${SCRIPT_PATH}" --normalize-oauth-session --oauth-session-out "${output_file}" >"${output_log}"

  assert_contains '{"credentials":{"accessToken":"plain-access","authorizedAt":"2026-03-19T00:00:00.000Z"}}' "${output_file}"
  assert_contains "[tests/live] wrote oauth session snapshot to ${output_file}" "${output_log}"
}

test_docs_reference_unified_entrypoint() {
  assert_contains "bash tests/live/run.sh" "${ROOT_DIR}/README.md"
  assert_contains "bash tests/live/run.sh" "${ROOT_DIR}/scripts/README.md"
  assert_contains "bash tests/live/run.sh" "${ROOT_DIR}/docs/README.md"
  assert_contains "bash tests/live/run.sh" "${ROOT_DIR}/tests/live/README.md"
  assert_not_contains "bash tests/live/scenarios/run-live-scenario.sh" "${ROOT_DIR}/README.md"
  assert_not_contains "bash tests/live/scenarios/run-live-scenario.sh" "${ROOT_DIR}/scripts/README.md"
  assert_not_contains "bash tests/live/scenarios/run-live-scenario.sh" "${ROOT_DIR}/docs/README.md"
}

test_defaults_to_batch_runner
test_runs_single_scenario
test_runs_shared_bootstrap_only
test_runs_prepare_only_for_scenario
test_routes_multi_orchestrator_scenario_to_special_runner
test_normalizes_oauth_session_from_env
test_writes_normalized_oauth_session_to_file
test_docs_reference_unified_entrypoint

echo "[tests/live/run.test] PASS"
