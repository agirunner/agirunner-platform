#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/prepare-live-test-environment.sh"

fail() {
  echo "[tests/live/prepare-live-test-environment.test] $*" >&2
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

test_happy_path_runs_bootstrap_steps_and_writes_context() {
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
  mkdir -p "${stubdir}" "${runtime_root}" "${fixtures_root}" "${fake_platform_root}/apps/platform-api" "$(dirname "${envfile}")"
  touch "${runtime_root}/Dockerfile.execution"
  touch "${fake_platform_root}/docker-compose.yml"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
LIVE_TEST_PROVIDER_API_KEY=test-provider-key
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
  make_stub "${stubdir}/python3" 'printf "python3 %s\n" "$*" >>"'"${logfile}"'"; printf "python3 DEFAULT_ADMIN_API_KEY=%s LIVE_TEST_PROVIDER_API_KEY=%s LIVE_TEST_GITHUB_TOKEN=%s PLATFORM_API_BASE_URL=%s LIVE_TEST_TRACE_DIR=%s ORCHESTRATOR_WORKER_NAME=%s LIVE_TEST_PROVIDER_TYPE=%s LIVE_TEST_MODEL_ID=%s\n" "${DEFAULT_ADMIN_API_KEY:-}" "${LIVE_TEST_PROVIDER_API_KEY:-}" "${LIVE_TEST_GITHUB_TOKEN:-}" "${PLATFORM_API_BASE_URL:-}" "${LIVE_TEST_TRACE_DIR:-}" "${ORCHESTRATOR_WORKER_NAME:-}" "${LIVE_TEST_PROVIDER_TYPE:-}" "${LIVE_TEST_MODEL_ID:-}" >>"'"${logfile}"'"; printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"sdlc-proof-workspace\",\"provider_id\":\"provider-1\",\"model_id\":\"model-1\"}"'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_PLATFORM_ROOT="${fake_platform_root}" \
    RUNTIME_REPO_PATH="${runtime_root}" \
    FIXTURES_REPO_PATH="${fixtures_root}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    "${SCRIPT_PATH}" >"${stdout_log}"

  assert_contains "docker build -t agirunner-runtime:local ${runtime_root}" "${logfile}"
  assert_contains "docker build -f ${runtime_root}/Dockerfile.execution -t agirunner-runtime-execution:local ${runtime_root}" "${logfile}"
  assert_contains "docker compose -f ${fake_platform_root}/docker-compose.yml down -v --remove-orphans" "${logfile}"
  assert_contains "docker compose -f ${fake_platform_root}/docker-compose.yml up -d --build" "${logfile}"
  assert_contains "curl --fail --silent --show-error http://127.0.0.1:8080/health" "${logfile}"
  assert_contains "git -C ${fixtures_root} fetch origin" "${logfile}"
  assert_contains "git -C ${fixtures_root} checkout main" "${logfile}"
  assert_contains "git -C ${fixtures_root} reset --hard origin/main" "${logfile}"
  assert_contains "git -C ${fixtures_root} clean -fdx" "${logfile}"
  assert_contains "python3 ${fake_platform_root}/tests/live/lib/seed_live_test_environment.py" "${logfile}"
  assert_contains "python3 DEFAULT_ADMIN_API_KEY=test-admin-key LIVE_TEST_PROVIDER_API_KEY=test-provider-key LIVE_TEST_GITHUB_TOKEN=test-github-token PLATFORM_API_BASE_URL=http://127.0.0.1:8080 LIVE_TEST_TRACE_DIR=${trace_dir} ORCHESTRATOR_WORKER_NAME=orchestrator-primary LIVE_TEST_PROVIDER_TYPE=openai LIVE_TEST_MODEL_ID=gpt-5.4" "${logfile}"
  assert_contains "[tests/live] building runtime image agirunner-runtime:local" "${stdout_log}"
  assert_contains "\"workspace_id\":\"workspace-1\"" "${bootstrap_context_file}"
}

test_fails_fast_when_admin_key_missing() {
  local tmpdir stubdir envfile runtime_root fixtures_root fake_platform_root
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  envfile="${tmpdir}/env/local.env"
  runtime_root="${tmpdir}/runtime"
  fixtures_root="${tmpdir}/fixtures"
  fake_platform_root="${tmpdir}/platform"
  mkdir -p "${stubdir}" "${runtime_root}" "${fixtures_root}" "${fake_platform_root}/apps/platform-api" "$(dirname "${envfile}")"
  touch "${runtime_root}/Dockerfile.execution"
  touch "${fake_platform_root}/docker-compose.yml"

  cat >"${envfile}" <<'EOF'
LIVE_TEST_PROVIDER_API_KEY=test-provider-key
LIVE_TEST_GITHUB_TOKEN=test-github-token
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5433
PLATFORM_API_PORT=8080
EOF

  make_stub "${stubdir}/docker" ':'
  make_stub "${stubdir}/git" ':'
  make_stub "${stubdir}/curl" ':'
  make_stub "${stubdir}/python3" ':'

  if PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_PLATFORM_ROOT="${fake_platform_root}" \
    RUNTIME_REPO_PATH="${runtime_root}" \
    FIXTURES_REPO_PATH="${fixtures_root}" \
    "${SCRIPT_PATH}" >"${tmpdir}/stdout.log" 2>"${tmpdir}/stderr.log"; then
    fail "expected bootstrap to fail when admin key is missing"
  fi

  assert_contains "[tests/live] DEFAULT_ADMIN_API_KEY is required" "${tmpdir}/stderr.log"
}

test_happy_path_runs_bootstrap_steps_and_writes_context
test_fails_fast_when_admin_key_missing

echo "[tests/live/prepare-live-test-environment.test] PASS"
