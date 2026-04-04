#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
SCRIPT_UNDER_TEST="${PLATFORM_ROOT}/tests/live/scripts/prepare-live-test-shared-environment.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
mkdir -p "${BIN_DIR}"

cat >"${BIN_DIR}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  build)
    exit 0
    ;;
  network)
    case "${2:-}" in
      inspect) exit 1 ;;
      create) exit 0 ;;
    esac
    ;;
  compose)
    if [[ "$*" == *" exec -T platform-api env"* ]]; then
      printf 'JWT_SECRET=%s\n' "${JWT_SECRET}"
      printf 'WEBHOOK_ENCRYPTION_KEY=%s\n' "${WEBHOOK_ENCRYPTION_KEY}"
      printf 'DEFAULT_ADMIN_API_KEY=%s\n' "${DEFAULT_ADMIN_API_KEY}"
      printf 'PLATFORM_SERVICE_API_KEY=%s\n' "${PLATFORM_SERVICE_API_KEY}"
      exit 0
    fi
    env | sort >>"${DOCKER_ENV_LOG:?}"
    exit 0
    ;;
  ps)
    exit 0
    ;;
esac

exit 0
EOF

cat >"${BIN_DIR}/git" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${BIN_DIR}/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${BIN_DIR}/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '{"shared_bootstrap_key":"local-catalog-test"}' >"${LIVE_TEST_SHARED_CONTEXT_FILE:?}"
EOF

chmod +x "${BIN_DIR}/docker" "${BIN_DIR}/git" "${BIN_DIR}/curl" "${BIN_DIR}/python3"

ENV_FILE="${TMP_DIR}/local.env"
cat >"${ENV_FILE}" <<'EOF'
DEFAULT_ADMIN_API_KEY=ab_admin_def_local_dev_123456789012345
PLATFORM_SERVICE_API_KEY=ar_service_test-service-key-123456
JWT_SECRET=test-jwt-secret
WEBHOOK_ENCRYPTION_KEY=test-webhook-secret
EOF

PLATFORM_ROOT_FIXTURE="${TMP_DIR}/platform"
RUNTIME_REPO_PATH="${TMP_DIR}/runtime"
FIXTURES_REPO_PATH="${TMP_DIR}/fixtures"
PLAYBOOKS_REPO_PATH="${TMP_DIR}/playbooks"
LIVE_TEST_LIBRARY_ROOT="${TMP_DIR}/library"
LIVE_TEST_RUN_SCRIPT="${TMP_DIR}/seed.py"
mkdir -p \
  "${PLATFORM_ROOT_FIXTURE}/apps/platform-api" \
  "${PLATFORM_ROOT_FIXTURE}/tests/live" \
  "${RUNTIME_REPO_PATH}" \
  "${FIXTURES_REPO_PATH}/.git" \
  "${PLAYBOOKS_REPO_PATH}" \
  "${LIVE_TEST_LIBRARY_ROOT}" \
  "${TMP_DIR}/results/bootstrap/api-trace"

cat >"${PLATFORM_ROOT_FIXTURE}/docker-compose.yml" <<'EOF'
services: {}
EOF

cat >"${PLATFORM_ROOT_FIXTURE}/tests/live/docker-compose.live-test.yml" <<'EOF'
services: {}
EOF

cat >"${LIVE_TEST_RUN_SCRIPT}" <<'EOF'
#!/usr/bin/env python3
EOF
chmod +x "${LIVE_TEST_RUN_SCRIPT}"

DOCKER_ENV_LOG="${TMP_DIR}/docker.env.log" \
PATH="${BIN_DIR}:${PATH}" \
LIVE_TEST_ENV_FILE="${ENV_FILE}" \
LIVE_TEST_PLATFORM_ROOT="${PLATFORM_ROOT_FIXTURE}" \
RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH}" \
FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH}" \
PLAYBOOKS_REPO_PATH="${PLAYBOOKS_REPO_PATH}" \
LIVE_TEST_LIBRARY_ROOT="${LIVE_TEST_LIBRARY_ROOT}" \
LIVE_TEST_COMPOSE_FILE="${PLATFORM_ROOT_FIXTURE}/docker-compose.yml" \
LIVE_TEST_COMPOSE_LIVE_TEST_FILE="${PLATFORM_ROOT_FIXTURE}/tests/live/docker-compose.live-test.yml" \
LIVE_TEST_RUN_SCRIPT="${LIVE_TEST_RUN_SCRIPT}" \
LIVE_TEST_ARTIFACTS_DIR="${TMP_DIR}/results" \
LIVE_TEST_BOOTSTRAP_DIR="${TMP_DIR}/results/bootstrap" \
LIVE_TEST_SHARED_CONTEXT_FILE="${TMP_DIR}/results/bootstrap/context.json" \
LIVE_TEST_TRACE_DIR="${TMP_DIR}/results/bootstrap/api-trace" \
COMMUNITY_CATALOG_REF="v0.1.0-alpha.3" \
"${SCRIPT_UNDER_TEST}" >"${TMP_DIR}/stdout.log" 2>"${TMP_DIR}/stderr.log"

grep -Fq "COMMUNITY_CATALOG_LOCAL_HOST_ROOT=${PLAYBOOKS_REPO_PATH}" "${TMP_DIR}/docker.env.log"
grep -Fq "COMMUNITY_CATALOG_LOCAL_ROOT=/community-catalog-source" "${TMP_DIR}/docker.env.log" # pragma: allowlist secret
if grep -Fq "COMMUNITY_CATALOG_REF=v0.1.0-alpha.3" "${TMP_DIR}/docker.env.log"; then
  echo "expected live shared bootstrap to clear COMMUNITY_CATALOG_REF when local playbooks checkout exists" >&2
  exit 1
fi
