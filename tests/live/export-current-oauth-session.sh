#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
LIVE_TEST_PLATFORM_ROOT="${LIVE_TEST_PLATFORM_ROOT:-$(cd "${LIVE_TEST_ROOT}/../.." && pwd)}"
LIVE_TEST_COMPOSE_FILE="${LIVE_TEST_COMPOSE_FILE:-${LIVE_TEST_PLATFORM_ROOT}/docker-compose.yml}"
LIVE_TEST_COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME:-agirunner-platform}"
LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID="${LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID:-openai-codex}"
LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE="${LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE:-}"

load_live_test_env "${LIVE_TEST_ENV_FILE}"
require_live_test_value "LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID" "${LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID}"
require_live_test_value "LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON" "${LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON:-}"

session_json="$(
  python3 - <<'PY'
import json
import os
import sys

payload_text = os.environ.get("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON", "").strip()
profile_id = os.environ.get("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID", "").strip() or "openai-codex"
if not payload_text:
    raise SystemExit("[tests/live] LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON is required")

payload = json.loads(payload_text)
credentials = payload.get("credentials")
if not isinstance(credentials, dict):
    raise SystemExit("[tests/live] exported oauth session missing credentials object")
access_token = credentials.get("accessToken")
if not isinstance(access_token, str) or access_token.strip() == "":
    raise SystemExit("[tests/live] exported oauth session missing access token")
if credentials.get("needsReauth") is True:
    raise SystemExit(f"[tests/live] oauth session for profile {profile_id} requires reauthorization")
print(json.dumps(payload, separators=(",", ":")))
PY
)"

if [[ -n "${LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE}" ]]; then
  mkdir -p "$(dirname "${LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE}")"
  printf '%s\n' "${session_json}" >"${LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE}"
  log_live_test "wrote oauth session snapshot to ${LIVE_TEST_PROVIDER_OAUTH_SESSION_OUTPUT_FILE}"
else
  printf '%s\n' "${session_json}"
fi
