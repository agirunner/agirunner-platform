#!/usr/bin/env bash
set -euo pipefail

COMMUNITY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${COMMUNITY_ROOT}/../.." && pwd)"
LIVE_ROOT="${REPO_ROOT}/tests/live"

# shellcheck disable=SC1091
source "${LIVE_ROOT}/lib/common.sh"

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_ROOT}/env/local.env}"
load_live_test_env "${LIVE_TEST_ENV_FILE}"

COMMUNITY_RESULTS_DIR="${COMMUNITY_PLAYBOOKS_RESULTS_DIR:-${COMMUNITY_ROOT}/results}"
COMMUNITY_BOOTSTRAP_DIR="${COMMUNITY_RESULTS_DIR}/bootstrap"
COMMUNITY_TRACE_DIR="${COMMUNITY_BOOTSTRAP_DIR}/api-trace"
LIVE_TEST_PLATFORM_ROOT="${LIVE_TEST_PLATFORM_ROOT:-${REPO_ROOT}}"
LIVE_TEST_COMPOSE_FILE="${LIVE_TEST_COMPOSE_FILE:-${LIVE_TEST_PLATFORM_ROOT}/docker-compose.yml}"
LIVE_TEST_COMPOSE_LIVE_TEST_FILE="${LIVE_TEST_COMPOSE_LIVE_TEST_FILE:-${LIVE_TEST_PLATFORM_ROOT}/tests/live/docker-compose.live-test.yml}"
LIVE_TEST_COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME:-agirunner-platform}"
LIVE_TEST_COMPOSE_PROFILES="${LIVE_TEST_COMPOSE_PROFILES:-live-test}"
RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH:-${REPO_ROOT}/../agirunner-runtime}"
FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH:-${REPO_ROOT}/../agirunner-test-fixtures}"
PLAYBOOKS_REPO_PATH="${PLAYBOOKS_REPO_PATH:-${REPO_ROOT}/../../agirunner/agirunner-playbooks}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-agirunner-runtime:local}"
LIVE_TEST_REMOTE_MCP_FIXTURE_PORT="${LIVE_TEST_REMOTE_MCP_FIXTURE_PORT:-18080}"
LIVE_TEST_DEFAULT_BRANCH="${LIVE_TEST_DEFAULT_BRANCH:-main}"
LIVE_TEST_FIXTURES_REMOTE_NAME="${LIVE_TEST_FIXTURES_REMOTE_NAME:-origin}"

require_live_test_dir "${RUNTIME_REPO_PATH}" "runtime repo"
require_live_test_file "${LIVE_TEST_COMPOSE_FILE}" "platform docker compose file"
require_live_test_file "${LIVE_TEST_COMPOSE_LIVE_TEST_FILE}" "live test compose override file"
require_live_test_value "DEFAULT_ADMIN_API_KEY" "${DEFAULT_ADMIN_API_KEY:-}"
require_live_test_value "PLATFORM_SERVICE_API_KEY" "${PLATFORM_SERVICE_API_KEY:-}"
require_live_test_value "JWT_SECRET" "${JWT_SECRET:-}"
require_live_test_value "WEBHOOK_ENCRYPTION_KEY" "${WEBHOOK_ENCRYPTION_KEY:-}"
require_live_test_dir "${FIXTURES_REPO_PATH}" "fixtures repo"

mkdir -p "${COMMUNITY_BOOTSTRAP_DIR}" "${COMMUNITY_TRACE_DIR}"

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

log_live_test "rebuilding compose stack for community playbooks"
(
  cd "${LIVE_TEST_PLATFORM_ROOT}"
  export COMPOSE_PROJECT_NAME="${LIVE_TEST_COMPOSE_PROJECT_NAME}"
  export COMPOSE_PROFILES="${LIVE_TEST_COMPOSE_PROFILES}"
  export DEFAULT_ADMIN_API_KEY PLATFORM_SERVICE_API_KEY JWT_SECRET WEBHOOK_ENCRYPTION_KEY
  export COMMUNITY_CATALOG_LOCAL_HOST_ROOT COMMUNITY_CATALOG_LOCAL_ROOT
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

export COMMUNITY_PLAYBOOKS_RESULTS_DIR="${COMMUNITY_RESULTS_DIR}"
export LIVE_TEST_TRACE_DIR="${COMMUNITY_TRACE_DIR}"
export RUNTIME_IMAGE
python3 "${COMMUNITY_ROOT}/lib/bootstrap.py"
