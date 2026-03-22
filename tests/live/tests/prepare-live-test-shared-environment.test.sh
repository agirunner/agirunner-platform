#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/prepare-live-test-shared-environment.sh"

fail() {
  echo "[tests/live/prepare-live-test-shared-environment.test] $*" >&2
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

test_shared_bootstrap_builds_stack_syncs_fixture_repo_and_writes_profile_registry() {
  local tmpdir stubdir logfile stdout_log envfile runtime_root fixtures_root output_root bootstrap_context_file trace_dir fake_platform_root
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  stdout_log="${tmpdir}/stdout.log"
  envfile="${tmpdir}/env/local.env"
  runtime_root="${tmpdir}/runtime"
  fixtures_root="${tmpdir}/fixtures"
  fake_platform_root="${tmpdir}/platform"
  output_root="${tmpdir}/out"
  bootstrap_context_file="${output_root}/bootstrap/context.json"
  trace_dir="${output_root}/bootstrap/api-trace"
  mkdir -p "${stubdir}" "${runtime_root}" "${fixtures_root}" "${fake_platform_root}/apps/platform-api" "${fake_platform_root}/tests/live/lib" "$(dirname "${envfile}")"
  touch "${runtime_root}/Dockerfile.execution"
  touch "${fake_platform_root}/docker-compose.yml"
  touch "${fake_platform_root}/tests/live/lib/seed_live_test_shared_environment.py"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
LIVE_TEST_PROVIDER_AUTH_MODE=oauth
LIVE_TEST_OAUTH_PROFILE_ID=openai-codex
LIVE_TEST_OAUTH_SESSION_JSON='{"credentials":{"accessToken":"enc:v1:access","refreshToken":"enc:v1:refresh"}}'
LIVE_TEST_GITHUB_TOKEN=test-github-token
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5433
PLATFORM_API_PORT=8080
EOF

  make_stub "${stubdir}/docker" 'printf "docker %s\n" "$*" >>"'"${logfile}"'"'
  make_stub "${stubdir}/git" 'printf "git %s\n" "$*" >>"'"${logfile}"'"'
  make_stub "${stubdir}/curl" 'printf "curl %s\n" "$*" >>"'"${logfile}"'"'
  make_stub "${stubdir}/python3" 'printf "python3 %s LIVE_TEST_MODEL_ID=%s LIVE_TEST_SYSTEM_REASONING_EFFORT=%s LIVE_TEST_ORCHESTRATOR_MODEL_ID=%s LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT=%s LIVE_TEST_SPECIALIST_MODEL_ID=%s LIVE_TEST_SPECIALIST_REASONING_EFFORT=%s LIVE_TEST_TRACE_DIR=%s\n" "$*" "${LIVE_TEST_MODEL_ID:-}" "${LIVE_TEST_SYSTEM_REASONING_EFFORT:-}" "${LIVE_TEST_ORCHESTRATOR_MODEL_ID:-}" "${LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT:-}" "${LIVE_TEST_SPECIALIST_MODEL_ID:-}" "${LIVE_TEST_SPECIALIST_REASONING_EFFORT:-}" "${LIVE_TEST_TRACE_DIR:-}" >>"'"${logfile}"'"; printf "%s\n" "{\"provider_auth_mode\":\"oauth\",\"profiles\":{\"content-direct-successor\":{\"playbook_id\":\"playbook-1\"}}}"'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_PLATFORM_ROOT="${fake_platform_root}" \
    RUNTIME_REPO_PATH="${runtime_root}" \
    FIXTURES_REPO_PATH="${fixtures_root}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    "${SCRIPT_PATH}" >"${stdout_log}"

  assert_contains "docker build -t agirunner-runtime:local ${runtime_root}" "${logfile}"
  assert_contains "docker build -f ${runtime_root}/Dockerfile.execution -t agirunner-runtime-execution:local ${runtime_root}" "${logfile}"
  assert_contains "git -C ${fixtures_root} update-ref -d refs/remotes/origin/main" "${logfile}"
  assert_contains "git -C ${fixtures_root} fetch --prune origin +refs/heads/main:refs/remotes/origin/main" "${logfile}"
  assert_contains "git -C ${fixtures_root} checkout main" "${logfile}"
  assert_contains "git -C ${fixtures_root} reset --hard origin/main" "${logfile}"
  assert_contains "python3 ${fake_platform_root}/tests/live/lib/seed_live_test_shared_environment.py LIVE_TEST_MODEL_ID=gpt-5.4-mini LIVE_TEST_SYSTEM_REASONING_EFFORT=medium LIVE_TEST_ORCHESTRATOR_MODEL_ID=gpt-5.4 LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT=low LIVE_TEST_SPECIALIST_MODEL_ID=gpt-5.4-mini LIVE_TEST_SPECIALIST_REASONING_EFFORT=medium LIVE_TEST_TRACE_DIR=${trace_dir}" "${logfile}"
  assert_contains "\"content-direct-successor\"" "${bootstrap_context_file}"
}

test_shared_bootstrap_builds_stack_syncs_fixture_repo_and_writes_profile_registry
