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

test_live_test_platform_api_secrets_match_succeeds_when_container_env_matches
test_live_test_platform_api_secrets_match_fails_when_container_env_drifts
