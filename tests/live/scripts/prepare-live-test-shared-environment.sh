#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${LIVE_TEST_ROOT}/../.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
load_live_test_env "${LIVE_TEST_ENV_FILE}"

LIVE_TEST_ARTIFACTS_DIR="${LIVE_TEST_ARTIFACTS_DIR:-$(default_live_test_artifacts_dir)}"
LIVE_TEST_BOOTSTRAP_DIR="${LIVE_TEST_BOOTSTRAP_DIR:-${LIVE_TEST_ARTIFACTS_DIR}/bootstrap}"
LIVE_TEST_SHARED_CONTEXT_FILE="${LIVE_TEST_SHARED_CONTEXT_FILE:-${LIVE_TEST_BOOTSTRAP_DIR}/context.json}"
LIVE_TEST_TRACE_DIR="${LIVE_TEST_TRACE_DIR:-${LIVE_TEST_BOOTSTRAP_DIR}/api-trace}"
LIVE_TEST_PLATFORM_ROOT="${LIVE_TEST_PLATFORM_ROOT:-${REPO_ROOT}}"
LIVE_TEST_COMPOSE_FILE="${LIVE_TEST_COMPOSE_FILE:-${LIVE_TEST_PLATFORM_ROOT}/docker-compose.yml}"
LIVE_TEST_COMPOSE_LIVE_TEST_FILE="${LIVE_TEST_COMPOSE_LIVE_TEST_FILE:-${LIVE_TEST_PLATFORM_ROOT}/tests/live/docker-compose.live-test.yml}"
LIVE_TEST_COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME:-agirunner-platform}"
LIVE_TEST_COMPOSE_PROFILES="${LIVE_TEST_COMPOSE_PROFILES:-live-test}"
LIVE_TEST_LIBRARY_ROOT="${LIVE_TEST_LIBRARY_ROOT:-${LIVE_TEST_ROOT}/library}"
LIVE_TEST_DEFAULT_BRANCH="${LIVE_TEST_DEFAULT_BRANCH:-main}"
LIVE_TEST_FIXTURES_REMOTE_NAME="${LIVE_TEST_FIXTURES_REMOTE_NAME:-origin}"
RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH:-${REPO_ROOT}/../agirunner-runtime}"
FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH:-${REPO_ROOT}/../agirunner-test-fixtures}"
PLAYBOOKS_REPO_PATH="${PLAYBOOKS_REPO_PATH:-${REPO_ROOT}/../../agirunner/agirunner-playbooks}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-agirunner-runtime:local}"
LIVE_TEST_REMOTE_MCP_FIXTURE_PORT="${LIVE_TEST_REMOTE_MCP_FIXTURE_PORT:-18080}"
LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET="${LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET:-live-test-parameterized-secret}"
LIVE_TEST_PROVIDER_AUTH_MODE="${LIVE_TEST_PROVIDER_AUTH_MODE:-oauth}"
LIVE_TEST_PROVIDER_TYPE="${LIVE_TEST_PROVIDER_TYPE:-openai}"
LIVE_TEST_PROVIDER_NAME="${LIVE_TEST_PROVIDER_NAME:-OpenAI (Subscription)}"
LIVE_TEST_PROVIDER_BASE_URL="${LIVE_TEST_PROVIDER_BASE_URL:-https://chatgpt.com/backend-api}"
LIVE_TEST_PROVIDER_API_KEY="${LIVE_TEST_PROVIDER_API_KEY:-${LIVE_TEST_OPENAI_API_KEY:-}}"
case "${LIVE_TEST_PROVIDER_TYPE}" in
  anthropic)
    LIVE_TEST_DEFAULT_MODEL_ID="claude-sonnet-4-6"
    LIVE_TEST_DEFAULT_MODEL_ENDPOINT_TYPE="messages"
    LIVE_TEST_DEFAULT_SYSTEM_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_ORCHESTRATOR_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_SPECIALIST_REASONING_EFFORT="low"
    ;;
  google|gemini)
    LIVE_TEST_DEFAULT_MODEL_ID="gemini-3.1-pro-preview"
    LIVE_TEST_DEFAULT_MODEL_ENDPOINT_TYPE="generate-content"
    LIVE_TEST_DEFAULT_SYSTEM_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_ORCHESTRATOR_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_SPECIALIST_REASONING_EFFORT="low"
    ;;
  *)
    LIVE_TEST_DEFAULT_MODEL_ID="gpt-5.4"
    LIVE_TEST_DEFAULT_MODEL_ENDPOINT_TYPE="responses"
    LIVE_TEST_DEFAULT_SYSTEM_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_ORCHESTRATOR_REASONING_EFFORT="low"
    LIVE_TEST_DEFAULT_SPECIALIST_REASONING_EFFORT="low"
    ;;
esac
LIVE_TEST_MODEL_ID="${LIVE_TEST_MODEL_ID:-${LIVE_TEST_DEFAULT_MODEL_ID}}"
LIVE_TEST_MODEL_ENDPOINT_TYPE="${LIVE_TEST_MODEL_ENDPOINT_TYPE:-${LIVE_TEST_DEFAULT_MODEL_ENDPOINT_TYPE}}"
LIVE_TEST_SYSTEM_REASONING_EFFORT="${LIVE_TEST_SYSTEM_REASONING_EFFORT:-${LIVE_TEST_DEFAULT_SYSTEM_REASONING_EFFORT}}"
LIVE_TEST_ORCHESTRATOR_MODEL_ID="${LIVE_TEST_ORCHESTRATOR_MODEL_ID:-${LIVE_TEST_MODEL_ID}}"
LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE="${LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE:-${LIVE_TEST_MODEL_ENDPOINT_TYPE}}"
LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT="${LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT:-${LIVE_TEST_DEFAULT_ORCHESTRATOR_REASONING_EFFORT}}"
LIVE_TEST_ORCHESTRATOR_REPLICAS="${LIVE_TEST_ORCHESTRATOR_REPLICAS:-1}"
LIVE_TEST_SPECIALIST_MODEL_ID="${LIVE_TEST_SPECIALIST_MODEL_ID:-${LIVE_TEST_MODEL_ID}}"
LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE="${LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE:-${LIVE_TEST_MODEL_ENDPOINT_TYPE}}"
LIVE_TEST_SPECIALIST_REASONING_EFFORT="${LIVE_TEST_SPECIALIST_REASONING_EFFORT:-${LIVE_TEST_DEFAULT_SPECIALIST_REASONING_EFFORT}}"
LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED="${LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED:-live-test-shared-bootstrap}"
LIVE_TEST_RUN_SCRIPT="${LIVE_TEST_RUN_SCRIPT:-${LIVE_TEST_PLATFORM_ROOT}/tests/live/lib/seed_live_test_shared_environment.py}"
LIVE_TEST_SHARED_BOOTSTRAP_KEY="$(
  resolve_live_test_shared_bootstrap_key "${LIVE_TEST_ROOT}" "${REPO_ROOT}" "${RUNTIME_REPO_PATH}"
)"
export LIVE_TEST_SHARED_BOOTSTRAP_KEY

require_live_test_dir "${RUNTIME_REPO_PATH}" "runtime repo"
require_live_test_dir "${LIVE_TEST_PLATFORM_ROOT}/apps/platform-api" "platform api app"
require_live_test_file "${LIVE_TEST_COMPOSE_FILE}" "platform docker compose file"
require_live_test_file "${LIVE_TEST_COMPOSE_LIVE_TEST_FILE}" "live test compose override file"
require_live_test_dir "${LIVE_TEST_LIBRARY_ROOT}" "live test library"
require_live_test_file "${LIVE_TEST_RUN_SCRIPT}" "shared live test seed script"
require_live_test_value "DEFAULT_ADMIN_API_KEY" "${DEFAULT_ADMIN_API_KEY:-}"
require_live_test_value "PLATFORM_SERVICE_API_KEY" "${PLATFORM_SERVICE_API_KEY:-}"
require_live_test_value "JWT_SECRET" "${JWT_SECRET:-}"
require_live_test_value "WEBHOOK_ENCRYPTION_KEY" "${WEBHOOK_ENCRYPTION_KEY:-}"
require_live_test_dir "${FIXTURES_REPO_PATH}" "fixtures repo"

verify_live_test_stack_secrets() {
  local platform_env
  platform_env="$(
    cd "${LIVE_TEST_PLATFORM_ROOT}"
    export COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME}"
    docker compose -p "${LIVE_TEST_COMPOSE_PROJECT_NAME}" \
      -f "${LIVE_TEST_COMPOSE_FILE}" \
      -f "${LIVE_TEST_COMPOSE_LIVE_TEST_FILE}" \
      exec -T platform-api env
  )"

  if ! grep -Fqx "JWT_SECRET=${JWT_SECRET}" <<<"${platform_env}"; then
    echo "[tests/live] platform-api JWT_SECRET does not match ${LIVE_TEST_ENV_FILE}" >&2
    exit 1
  fi
  if ! grep -Fqx "WEBHOOK_ENCRYPTION_KEY=${WEBHOOK_ENCRYPTION_KEY}" <<<"${platform_env}"; then
    echo "[tests/live] platform-api WEBHOOK_ENCRYPTION_KEY does not match ${LIVE_TEST_ENV_FILE}" >&2
    exit 1
  fi
  if ! grep -Fqx "DEFAULT_ADMIN_API_KEY=${DEFAULT_ADMIN_API_KEY}" <<<"${platform_env}"; then
    echo "[tests/live] platform-api DEFAULT_ADMIN_API_KEY does not match ${LIVE_TEST_ENV_FILE}" >&2
    exit 1
  fi
  if ! grep -Fqx "PLATFORM_SERVICE_API_KEY=${PLATFORM_SERVICE_API_KEY}" <<<"${platform_env}"; then
    echo "[tests/live] platform-api PLATFORM_SERVICE_API_KEY does not match ${LIVE_TEST_ENV_FILE}" >&2
    exit 1
  fi
}

mkdir -p "${LIVE_TEST_BOOTSTRAP_DIR}" "${LIVE_TEST_TRACE_DIR}"

if [[ -d "${PLAYBOOKS_REPO_PATH}" ]]; then
  export COMMUNITY_CATALOG_LOCAL_HOST_ROOT="${PLAYBOOKS_REPO_PATH}"
  export COMMUNITY_CATALOG_LOCAL_ROOT="/community-catalog-source"
  log_live_test "using local community catalog repo ${PLAYBOOKS_REPO_PATH}"
else
  unset COMMUNITY_CATALOG_LOCAL_HOST_ROOT
  unset COMMUNITY_CATALOG_LOCAL_ROOT
  log_live_test "local community catalog repo not found; falling back to ${COMMUNITY_CATALOG_RAW_BASE_URL:-https://raw.githubusercontent.com}"
fi

log_live_test "building runtime image ${RUNTIME_IMAGE}"
docker build -t "${RUNTIME_IMAGE}" "${RUNTIME_REPO_PATH}"

refresh_live_test_remote_branch "${FIXTURES_REPO_PATH}" "${LIVE_TEST_DEFAULT_BRANCH}" "${LIVE_TEST_FIXTURES_REMOTE_NAME}"
git -C "${FIXTURES_REPO_PATH}" checkout "${LIVE_TEST_DEFAULT_BRANCH}"
git -C "${FIXTURES_REPO_PATH}" reset --hard "${LIVE_TEST_FIXTURES_REMOTE_NAME}/${LIVE_TEST_DEFAULT_BRANCH}"
git -C "${FIXTURES_REPO_PATH}" clean -fdx

log_live_test "rebuilding standard docker compose stack"
(
  cd "${LIVE_TEST_PLATFORM_ROOT}"
  export COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME}"
  export COMPOSE_PROFILES="${LIVE_TEST_COMPOSE_PROFILES}"
  export DEFAULT_ADMIN_API_KEY PLATFORM_SERVICE_API_KEY JWT_SECRET WEBHOOK_ENCRYPTION_KEY
  export COMMUNITY_CATALOG_LOCAL_HOST_ROOT COMMUNITY_CATALOG_LOCAL_ROOT
  export LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET
  docker compose -p "${LIVE_TEST_COMPOSE_PROJECT_NAME}" \
    -f "${LIVE_TEST_COMPOSE_FILE}" \
    -f "${LIVE_TEST_COMPOSE_LIVE_TEST_FILE}" \
    down -v --remove-orphans
  wait_for_live_test_compose_project_down "${LIVE_TEST_COMPOSE_PROJECT_NAME}"
  ensure_live_test_external_network "${LIVE_TEST_COMPOSE_PROJECT_NAME}_platform_net"
  docker compose -p "${LIVE_TEST_COMPOSE_PROJECT_NAME}" \
    -f "${LIVE_TEST_COMPOSE_FILE}" \
    -f "${LIVE_TEST_COMPOSE_LIVE_TEST_FILE}" \
    up -d --build
)

export PLATFORM_API_BASE_URL="${PLATFORM_API_BASE_URL:-http://127.0.0.1:${PLATFORM_API_PORT:-8080}}"
wait_for_live_test_http "${PLATFORM_API_BASE_URL}/health" "platform api health"
wait_for_live_test_http "http://127.0.0.1:${LIVE_TEST_REMOTE_MCP_FIXTURE_PORT}/health" "remote mcp fixture health"
verify_live_test_stack_secrets

log_live_test "seeding shared platform state through API"
export LIVE_TEST_TRACE_DIR
export LIVE_TEST_LIBRARY_ROOT
export LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET
export LIVE_TEST_PROVIDER_AUTH_MODE
export LIVE_TEST_PROVIDER_TYPE
export LIVE_TEST_PROVIDER_NAME
export LIVE_TEST_PROVIDER_BASE_URL
export LIVE_TEST_PROVIDER_API_KEY
export LIVE_TEST_MODEL_ID
export LIVE_TEST_MODEL_ENDPOINT_TYPE
export LIVE_TEST_SYSTEM_REASONING_EFFORT
export LIVE_TEST_ORCHESTRATOR_MODEL_ID
export LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE
export LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT
export LIVE_TEST_ORCHESTRATOR_REPLICAS
export LIVE_TEST_SPECIALIST_MODEL_ID
export LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE
export LIVE_TEST_SPECIALIST_REASONING_EFFORT
export LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED
export LIVE_TEST_SHARED_BOOTSTRAP_KEY

bootstrap_context_target="${LIVE_TEST_SHARED_CONTEXT_FILE}"
bootstrap_context_tmp="${LIVE_TEST_SHARED_CONTEXT_FILE}.tmp.$$"
rm -f "${bootstrap_context_tmp}"

LIVE_TEST_SHARED_CONTEXT_FILE="${bootstrap_context_tmp}" python3 "${LIVE_TEST_RUN_SCRIPT}"

if [[ ! -s "${bootstrap_context_tmp}" ]]; then
  echo "[tests/live] shared bootstrap context file was not written: ${bootstrap_context_tmp}" >&2
  exit 1
fi

if ! shared_live_test_context_has_bootstrap_key "${bootstrap_context_tmp}" "${LIVE_TEST_SHARED_BOOTSTRAP_KEY}"; then
  echo "[tests/live] shared bootstrap context is missing the expected bootstrap key" >&2
  exit 1
fi

mv "${bootstrap_context_tmp}" "${bootstrap_context_target}"

log_live_test "shared bootstrap context written to ${LIVE_TEST_SHARED_CONTEXT_FILE}"
