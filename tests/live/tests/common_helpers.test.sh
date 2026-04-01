#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

test_live_test_platform_api_secrets_match_succeeds_when_container_env_matches() {
  DEFAULT_ADMIN_API_KEY="admin-secret"
  JWT_SECRET="jwt-secret"
  WEBHOOK_ENCRYPTION_KEY="webhook-secret"

  docker() {
    if [[ "$1" == "ps" ]]; then
      printf 'container-123\n'
      return 0
    fi
    if [[ "$1" == "exec" ]]; then
      cat <<'EOF'
DEFAULT_ADMIN_API_KEY=admin-secret
JWT_SECRET=jwt-secret
WEBHOOK_ENCRYPTION_KEY=webhook-secret
EOF
      return 0
    fi
    echo "unexpected docker invocation: $*" >&2
    return 1
  }

  live_test_platform_api_secrets_match
}

test_live_test_platform_api_secrets_match_fails_when_container_env_drifts() {
  DEFAULT_ADMIN_API_KEY="admin-secret"
  JWT_SECRET="jwt-secret"
  WEBHOOK_ENCRYPTION_KEY="webhook-secret"

  docker() {
    if [[ "$1" == "ps" ]]; then
      printf 'container-123\n'
      return 0
    fi
    if [[ "$1" == "exec" ]]; then
      cat <<'EOF'
DEFAULT_ADMIN_API_KEY=admin-secret
JWT_SECRET=stale-jwt
WEBHOOK_ENCRYPTION_KEY=stale-webhook
EOF
      return 0
    fi
    echo "unexpected docker invocation: $*" >&2
    return 1
  }

  if live_test_platform_api_secrets_match; then
    echo "expected live_test_platform_api_secrets_match to fail on env drift" >&2
    exit 1
  fi
}

test_load_live_test_env_preserves_existing_env_overrides() {
  local env_file
  env_file="$(mktemp)"
  cat >"${env_file}" <<'EOF'
LIVE_TEST_PROVIDER_AUTH_MODE=oauth
LIVE_TEST_PROVIDER_TYPE=openai
LIVE_TEST_PROVIDER_NAME=OpenAI (Subscription)
EOF

  LIVE_TEST_PROVIDER_AUTH_MODE="api_key"
  LIVE_TEST_PROVIDER_TYPE="anthropic"
  LIVE_TEST_PROVIDER_NAME="Anthropic"

  load_live_test_env "${env_file}"

  if [[ "${LIVE_TEST_PROVIDER_AUTH_MODE}" != "api_key" ]]; then
    echo "expected provider auth mode override to survive env load" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_TYPE}" != "anthropic" ]]; then
    echo "expected provider type override to survive env load" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_NAME}" != "Anthropic" ]]; then
    echo "expected provider name override to survive env load" >&2
    exit 1
  fi
}

test_live_test_platform_api_secrets_match_succeeds_when_container_env_matches
test_live_test_platform_api_secrets_match_fails_when_container_env_drifts
test_load_live_test_env_preserves_existing_env_overrides
