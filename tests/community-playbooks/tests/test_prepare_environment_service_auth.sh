#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_PATH="${REPO_ROOT}/tests/community-playbooks/scripts/prepare-community-playbooks-environment.sh"

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
exit 0
EOF

chmod +x "${BIN_DIR}/docker" "${BIN_DIR}/git" "${BIN_DIR}/curl" "${BIN_DIR}/python3"

RUNTIME_REPO_PATH="${TMP_DIR}/runtime"
FIXTURES_REPO_PATH="${TMP_DIR}/fixtures"
mkdir -p "${RUNTIME_REPO_PATH}" "${FIXTURES_REPO_PATH}/.git"

seed_playbooks_manifest() {
  local playbooks_root="$1"
  mkdir -p "${playbooks_root}/catalog"
  cat >"${playbooks_root}/catalog/playbooks.yaml" <<'EOF'
catalog_version: 1
playbooks: []
EOF
}

run_script() {
  local env_file="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local env_log="$4"

  DOCKER_ENV_LOG="${env_log}" \
  PATH="${BIN_DIR}:${PATH}" \
  LIVE_TEST_ENV_FILE="${env_file}" \
  COMMUNITY_PLAYBOOKS_RESULTS_DIR="${TMP_DIR}/results" \
  RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH}" \
  FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH}" \
  bash "${SCRIPT_PATH}" >"${stdout_file}" 2>"${stderr_file}"
}

MISSING_ENV_FILE="${TMP_DIR}/missing.env"
cat >"${MISSING_ENV_FILE}" <<'EOF'
DEFAULT_ADMIN_API_KEY=ab_admin_def_local_dev_123456789012345
JWT_SECRET=test-jwt-secret
WEBHOOK_ENCRYPTION_KEY=test-webhook-secret
EOF

if run_script "${MISSING_ENV_FILE}" "${TMP_DIR}/missing.out" "${TMP_DIR}/missing.err" "${TMP_DIR}/missing.env.log"; then
  echo "expected community bootstrap script to fail when PLATFORM_SERVICE_API_KEY is missing" >&2
  exit 1
fi

grep -Fq "PLATFORM_SERVICE_API_KEY is required" "${TMP_DIR}/missing.err"

PRESENT_ENV_FILE="${TMP_DIR}/present.env"
cat >"${PRESENT_ENV_FILE}" <<'EOF'
DEFAULT_ADMIN_API_KEY=ab_admin_def_local_dev_123456789012345
PLATFORM_SERVICE_API_KEY=ar_service_test-service-key-123456
JWT_SECRET=test-jwt-secret
WEBHOOK_ENCRYPTION_KEY=test-webhook-secret
EOF

run_script "${PRESENT_ENV_FILE}" "${TMP_DIR}/present.out" "${TMP_DIR}/present.err" "${TMP_DIR}/present.env.log"

grep -Fq "PLATFORM_SERVICE_API_KEY=ar_service_test-service-key-123456" "${TMP_DIR}/present.env.log" # pragma: allowlist secret

PLAYBOOKS_REPO_PATH="${TMP_DIR}/playbooks"
mkdir -p "${PLAYBOOKS_REPO_PATH}"
seed_playbooks_manifest "${PLAYBOOKS_REPO_PATH}"

LOCAL_OVERRIDE_ENV_FILE="${TMP_DIR}/local-override.env"
cat >"${LOCAL_OVERRIDE_ENV_FILE}" <<'EOF'
DEFAULT_ADMIN_API_KEY=ab_admin_def_local_dev_123456789012345
PLATFORM_SERVICE_API_KEY=ar_service_test-service-key-123456
JWT_SECRET=test-jwt-secret
WEBHOOK_ENCRYPTION_KEY=test-webhook-secret
EOF

DOCKER_ENV_LOG="${TMP_DIR}/local-override.env.log" \
PATH="${BIN_DIR}:${PATH}" \
LIVE_TEST_ENV_FILE="${LOCAL_OVERRIDE_ENV_FILE}" \
COMMUNITY_PLAYBOOKS_RESULTS_DIR="${TMP_DIR}/results" \
RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH}" \
FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH}" \
PLAYBOOKS_REPO_PATH="${PLAYBOOKS_REPO_PATH}" \
COMMUNITY_CATALOG_REF="v0.1.0-alpha.3" \
bash "${SCRIPT_PATH}" >"${TMP_DIR}/local-override.out" 2>"${TMP_DIR}/local-override.err"

grep -Fq "COMMUNITY_CATALOG_LOCAL_HOST_ROOT=${PLAYBOOKS_REPO_PATH}" "${TMP_DIR}/local-override.env.log"
grep -Fq "COMMUNITY_CATALOG_LOCAL_ROOT=/community-catalog-source" "${TMP_DIR}/local-override.env.log" # pragma: allowlist secret
if grep -Fq "COMMUNITY_CATALOG_REF=v0.1.0-alpha.3" "${TMP_DIR}/local-override.env.log"; then
  echo "expected local community catalog override to clear COMMUNITY_CATALOG_REF" >&2
  exit 1
fi

INVALID_PLAYBOOKS_REPO_PATH="${TMP_DIR}/invalid-playbooks"
mkdir -p "${INVALID_PLAYBOOKS_REPO_PATH}"

if DOCKER_ENV_LOG="${TMP_DIR}/invalid-local.env.log" \
  PATH="${BIN_DIR}:${PATH}" \
  LIVE_TEST_ENV_FILE="${LOCAL_OVERRIDE_ENV_FILE}" \
  COMMUNITY_PLAYBOOKS_RESULTS_DIR="${TMP_DIR}/results" \
  RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH}" \
  FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH}" \
  PLAYBOOKS_REPO_PATH="${INVALID_PLAYBOOKS_REPO_PATH}" \
  bash "${SCRIPT_PATH}" >"${TMP_DIR}/invalid-local.out" 2>"${TMP_DIR}/invalid-local.err"; then
  echo "expected community bootstrap script to reject an invalid local playbooks repo" >&2
  exit 1
fi

grep -Fq "missing catalog/playbooks.yaml" "${TMP_DIR}/invalid-local.err"
