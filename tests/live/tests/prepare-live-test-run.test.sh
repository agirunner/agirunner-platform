#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/prepare-live-test-run.sh"

fail() {
  echo "[tests/live/prepare-live-test-run.test] $*" >&2
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

test_git_remote_run_preparation_uses_unique_branch_and_writes_run_context() {
  local tmpdir stubdir logfile envfile output_root shared_context_file run_context_file fixtures_root
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  shared_context_file="${output_root}/bootstrap/context.json"
  run_context_file="${output_root}/content-direct-successor-no-assessment/run-context.json"
  fixtures_root="${tmpdir}/fixtures"
  mkdir -p "${stubdir}" "$(dirname "${envfile}")" "$(dirname "${shared_context_file}")" "${fixtures_root}"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
LIVE_TEST_PROVIDER_AUTH_MODE=oauth
LIVE_TEST_OAUTH_PROFILE_ID=openai-codex
LIVE_TEST_OAUTH_SESSION_JSON='{"credentials":{"accessToken":"enc:v1:access","refreshToken":"enc:v1:refresh"}}'
LIVE_TEST_GITHUB_TOKEN=test-github-token
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  cat >"${shared_context_file}" <<'EOF'
{"provider_auth_mode":"oauth","profiles":{"content-direct-successor":{"playbook_id":"playbook-1","playbook_slug":"playbook-one"}}}
EOF

  make_stub "${stubdir}/git" 'printf "git %s\n" "$*" >>"'"${logfile}"'"'
  make_stub "${stubdir}/python3" '
if [[ "${1:-}" == "-" ]]; then
  printf "%s\n" "content-direct-successor" "git_remote"
else
  printf "python3 %s LIVE_TEST_DEFAULT_BRANCH=%s LIVE_TEST_HOST_WORKSPACE_PATH=%s LIVE_TEST_RUN_TOKEN=%s LIVE_TEST_SHARED_CONTEXT_FILE=%s\n" "$*" "${LIVE_TEST_DEFAULT_BRANCH:-}" "${LIVE_TEST_HOST_WORKSPACE_PATH:-}" "${LIVE_TEST_RUN_TOKEN:-}" "${LIVE_TEST_SHARED_CONTEXT_FILE:-}" >>"'"${logfile}"'"
  printf "%s\n" "{\"workspace_id\":\"workspace-1\",\"workspace_slug\":\"content-direct-successor-no-assessment-run-01\",\"playbook_id\":\"playbook-1\",\"run_token\":\"run-01\"}" >"${LIVE_TEST_RUN_CONTEXT_FILE}"
fi'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${shared_context_file}" \
    FIXTURES_REPO_PATH="${fixtures_root}" \
    LIVE_TEST_RUN_TOKEN="run-01" \
    "${SCRIPT_PATH}" "content-direct-successor-no-assessment" >"${tmpdir}/stdout.log"

  assert_contains "git clone ${fixtures_root}" "${logfile}"
  assert_contains "git -C ${output_root}/git-workspaces/content-direct-successor-no-assessment/run-01 checkout -B live-test/content-direct-successor-no-assessment/run-01 origin/main" "${logfile}"
  assert_contains "LIVE_TEST_DEFAULT_BRANCH=live-test/content-direct-successor-no-assessment/run-01" "${logfile}"
  assert_contains "\"workspace_id\":\"workspace-1\"" "${run_context_file}"
}

test_host_directory_run_preparation_uses_unique_host_workspace_path() {
  local tmpdir stubdir logfile envfile output_root shared_context_file run_context_file
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  envfile="${tmpdir}/env/local.env"
  output_root="${tmpdir}/artifacts"
  shared_context_file="${output_root}/bootstrap/context.json"
  run_context_file="${output_root}/host-directory-content-assessment/run-context.json"
  mkdir -p "${stubdir}" "$(dirname "${envfile}")" "$(dirname "${shared_context_file}")"

  cat >"${envfile}" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
LIVE_TEST_PROVIDER_AUTH_MODE=oauth
LIVE_TEST_OAUTH_PROFILE_ID=openai-codex
LIVE_TEST_OAUTH_SESSION_JSON='{"credentials":{"accessToken":"enc:v1:access","refreshToken":"enc:v1:refresh"}}'
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
POSTGRES_PORT=5432
PLATFORM_API_PORT=8080
EOF

  cat >"${shared_context_file}" <<'EOF'
{"provider_auth_mode":"oauth","profiles":{"host-directory-assessment":{"playbook_id":"playbook-host","playbook_slug":"playbook-host"}}}
EOF

  make_stub "${stubdir}/python3" '
if [[ "${1:-}" == "-" ]]; then
  printf "%s\n" "host-directory-assessment" "host_directory"
else
  printf "python3 %s LIVE_TEST_DEFAULT_BRANCH=%s LIVE_TEST_HOST_WORKSPACE_PATH=%s LIVE_TEST_RUN_TOKEN=%s\n" "$*" "${LIVE_TEST_DEFAULT_BRANCH:-}" "${LIVE_TEST_HOST_WORKSPACE_PATH:-}" "${LIVE_TEST_RUN_TOKEN:-}" >>"'"${logfile}"'"
  printf "%s\n" "{\"workspace_id\":\"workspace-host\",\"workspace_slug\":\"host-directory-content-assessment-run-02\",\"playbook_id\":\"playbook-host\",\"run_token\":\"run-02\"}" >"${LIVE_TEST_RUN_CONTEXT_FILE}"
fi'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_ARTIFACTS_DIR="${output_root}" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${shared_context_file}" \
    LIVE_TEST_RUN_TOKEN="run-02" \
    "${SCRIPT_PATH}" "host-directory-content-assessment" >"${tmpdir}/stdout.log"

  assert_contains "LIVE_TEST_HOST_WORKSPACE_PATH=${output_root}/host-workspaces/host-directory-content-assessment/run-02" "${logfile}"
  assert_contains "\"workspace_id\":\"workspace-host\"" "${run_context_file}"
}

test_git_remote_run_preparation_uses_unique_branch_and_writes_run_context
test_host_directory_run_preparation_uses_unique_host_workspace_path
