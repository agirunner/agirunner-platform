#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

test_live_test_platform_api_secrets_match_succeeds_when_container_env_matches() {
  DEFAULT_ADMIN_API_KEY="admin-secret" # pragma: allowlist secret
  PLATFORM_SERVICE_API_KEY="service-secret" # pragma: allowlist secret
  JWT_SECRET="jwt-secret" # pragma: allowlist secret
  WEBHOOK_ENCRYPTION_KEY="webhook-secret" # pragma: allowlist secret

  docker() {
    if [[ "$1" == "ps" ]]; then
      printf 'container-123\n'
      return 0
    fi
    if [[ "$1" == "exec" ]]; then
      cat <<'EOF'
DEFAULT_ADMIN_API_KEY=admin-secret
PLATFORM_SERVICE_API_KEY=service-secret
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
  DEFAULT_ADMIN_API_KEY="admin-secret" # pragma: allowlist secret
  PLATFORM_SERVICE_API_KEY="service-secret" # pragma: allowlist secret
  JWT_SECRET="jwt-secret" # pragma: allowlist secret
  WEBHOOK_ENCRYPTION_KEY="webhook-secret" # pragma: allowlist secret

  docker() {
    if [[ "$1" == "ps" ]]; then
      printf 'container-123\n'
      return 0
    fi
    if [[ "$1" == "exec" ]]; then
      cat <<'EOF'
DEFAULT_ADMIN_API_KEY=admin-secret
PLATFORM_SERVICE_API_KEY=stale-service
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

test_load_live_test_env_uses_env_file_as_authoritative_source() {
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

  if [[ "${LIVE_TEST_PROVIDER_AUTH_MODE}" != "oauth" ]]; then
    echo "expected env file to override stale provider auth mode" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_TYPE}" != "openai" ]]; then
    echo "expected env file to override stale provider type" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_NAME}" != "OpenAI (Subscription)" ]]; then
    echo "expected env file to override stale provider name" >&2
    exit 1
  fi
}

test_load_live_test_env_preserves_existing_values_when_requested() {
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

  load_live_test_env "${env_file}" preserve_existing

  if [[ "${LIVE_TEST_PROVIDER_AUTH_MODE}" != "api_key" ]]; then
    echo "expected explicit provider auth mode override to survive preserve_existing load" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_TYPE}" != "anthropic" ]]; then
    echo "expected explicit provider type override to survive preserve_existing load" >&2
    exit 1
  fi
  if [[ "${LIVE_TEST_PROVIDER_NAME}" != "Anthropic" ]]; then
    echo "expected explicit provider name override to survive preserve_existing load" >&2
    exit 1
  fi
}

test_ensure_live_test_external_network_creates_missing_network() {
  local inspect_calls=0
  local create_calls=0

  docker() {
    if [[ "$1" == "network" && "$2" == "inspect" ]]; then
      inspect_calls=$((inspect_calls + 1))
      return 1
    fi
    if [[ "$1" == "network" && "$2" == "create" ]]; then
      create_calls=$((create_calls + 1))
      if [[ "$3" != "agirunner-platform_platform_net" ]]; then
        echo "unexpected network name: $3" >&2
        return 1
      fi
      return 0
    fi
    echo "unexpected docker invocation: $*" >&2
    return 1
  }

  ensure_live_test_external_network "agirunner-platform_platform_net"

  if [[ "${inspect_calls}" -ne 1 ]]; then
    echo "expected one network inspect call" >&2
    exit 1
  fi
  if [[ "${create_calls}" -ne 1 ]]; then
    echo "expected one network create call" >&2
    exit 1
  fi
}

test_default_live_test_playbooks_repo_path_prefers_manifest_backed_sibling_checkout() {
  local workspace_root
  local platform_repo_root
  local expected_playbooks_root
  local stale_nested_root

  workspace_root="$(mktemp -d)"
  platform_repo_root="${workspace_root}/agirunner-platform"
  expected_playbooks_root="${workspace_root}/agirunner-playbooks"
  stale_nested_root="${workspace_root}/agirunner/agirunner-playbooks"

  mkdir -p "${platform_repo_root}" "${expected_playbooks_root}/catalog" "${stale_nested_root}"
  cat >"${expected_playbooks_root}/catalog/playbooks.yaml" <<'EOF'
catalog_version: 1
playbooks: []
EOF

  if [[ "$(default_live_test_playbooks_repo_path "${platform_repo_root}")" != "${expected_playbooks_root}" ]]; then
    echo "expected manifest-backed sibling playbooks checkout to win over stale nested path" >&2
    exit 1
  fi
}

test_live_test_platform_api_secrets_match_succeeds_when_container_env_matches
test_live_test_platform_api_secrets_match_fails_when_container_env_drifts
test_load_live_test_env_uses_env_file_as_authoritative_source
test_load_live_test_env_preserves_existing_values_when_requested
test_ensure_live_test_external_network_creates_missing_network
test_default_live_test_playbooks_repo_path_prefers_manifest_backed_sibling_checkout
