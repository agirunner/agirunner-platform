#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/tests/live/export-current-oauth-session.sh"

fail() {
  echo "[tests/live/export-current-oauth-session.test] $*" >&2
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

test_exports_session_json_to_stdout() {
  local tmpdir stubdir logfile envfile fake_platform_root stdout_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  envfile="${tmpdir}/env/local.env"
  fake_platform_root="${tmpdir}/platform"
  stdout_log="${tmpdir}/stdout.log"
  mkdir -p "${stubdir}" "${fake_platform_root}" "$(dirname "${envfile}")"
  touch "${fake_platform_root}/docker-compose.yml"

  cat >"${envfile}" <<'EOF'
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
EOF

  make_stub "${stubdir}/docker" 'printf "docker %s\n" "$*" >>"'"${logfile}"'"; printf "%s\n" "{\"credentials\":{\"accessToken\":\"enc:v1:access\",\"refreshToken\":\"enc:v1:refresh\",\"authorizedAt\":\"2026-03-19T00:00:00.000Z\"}}"'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_PLATFORM_ROOT="${fake_platform_root}" \
    LIVE_TEST_OAUTH_PROFILE_ID="openai-codex" \
    "${SCRIPT_PATH}" >"${stdout_log}"

  assert_contains "{\"credentials\":{\"accessToken\":\"enc:v1:access\",\"refreshToken\":\"enc:v1:refresh\",\"authorizedAt\":\"2026-03-19T00:00:00.000Z\"}}" "${stdout_log}"
  assert_contains "docker compose -p agirunner-platform -f ${fake_platform_root}/docker-compose.yml exec -T postgres psql -U agirunner -d agirunner -At -c" "${logfile}"
}

test_writes_session_json_to_requested_file() {
  local tmpdir stubdir logfile envfile fake_platform_root stdout_log output_file
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  stubdir="${tmpdir}/bin"
  logfile="${tmpdir}/calls.log"
  envfile="${tmpdir}/env/local.env"
  fake_platform_root="${tmpdir}/platform"
  stdout_log="${tmpdir}/stdout.log"
  output_file="${tmpdir}/snapshots/openai-session.json"
  mkdir -p "${stubdir}" "${fake_platform_root}" "$(dirname "${envfile}")"
  touch "${fake_platform_root}/docker-compose.yml"

  cat >"${envfile}" <<'EOF'
POSTGRES_DB=agirunner
POSTGRES_USER=agirunner
POSTGRES_PASSWORD=agirunner
EOF

  make_stub "${stubdir}/docker" 'printf "docker %s\n" "$*" >>"'"${logfile}"'"; printf "%s\n" "{\"credentials\":{\"accessToken\":\"enc:v1:access\",\"authorizedAt\":\"2026-03-19T00:00:00.000Z\"}}"'

  PATH="${stubdir}:${PATH}" \
    LIVE_TEST_ENV_FILE="${envfile}" \
    LIVE_TEST_PLATFORM_ROOT="${fake_platform_root}" \
    LIVE_TEST_OAUTH_PROFILE_ID="openai-codex" \
    LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE="${output_file}" \
    "${SCRIPT_PATH}" >"${stdout_log}"

  if [[ ! -f "${output_file}" ]]; then
    fail "expected output file to be created"
  fi
  assert_contains "{\"credentials\":{\"accessToken\":\"enc:v1:access\",\"authorizedAt\":\"2026-03-19T00:00:00.000Z\"}}" "${output_file}"
  assert_contains "[tests/live] wrote oauth session snapshot to ${output_file}" "${stdout_log}"
}

test_exports_session_json_to_stdout
test_writes_session_json_to_requested_file

echo "[tests/live/export-current-oauth-session.test] PASS"
