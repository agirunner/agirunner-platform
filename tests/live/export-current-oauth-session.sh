#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
LIVE_TEST_PLATFORM_ROOT="${LIVE_TEST_PLATFORM_ROOT:-$(cd "${LIVE_TEST_ROOT}/../.." && pwd)}"
LIVE_TEST_COMPOSE_FILE="${LIVE_TEST_COMPOSE_FILE:-${LIVE_TEST_PLATFORM_ROOT}/docker-compose.yml}"
LIVE_TEST_COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME:-agirunner-platform}"
LIVE_TEST_OAUTH_PROFILE_ID="${LIVE_TEST_OAUTH_PROFILE_ID:-openai-codex}"
LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE="${LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE:-}"

load_live_test_env "${LIVE_TEST_ENV_FILE}"
require_live_test_file "${LIVE_TEST_COMPOSE_FILE}" "platform docker compose file"
require_live_test_value "LIVE_TEST_OAUTH_PROFILE_ID" "${LIVE_TEST_OAUTH_PROFILE_ID}"

export LIVE_TEST_COMPOSE_FILE
export LIVE_TEST_COMPOSE_PROJECT_NAME
export LIVE_TEST_OAUTH_PROFILE_ID

session_json="$(
  python3 "${LIVE_TEST_ROOT}/lib/export_live_oauth_session.py"
)"

if [[ -n "${LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE}" ]]; then
  mkdir -p "$(dirname "${LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE}")"
  printf '%s\n' "${session_json}" >"${LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE}"
  log_live_test "wrote oauth session snapshot to ${LIVE_TEST_OAUTH_SESSION_OUTPUT_FILE}"
else
  printf '%s\n' "${session_json}"
fi
