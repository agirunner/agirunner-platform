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

compose_up_attempts_file="${COMPOSE_UP_ATTEMPTS_FILE:?}"

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
  ps)
    exit 0
    ;;
  compose)
    shift
    while [[ "${1:-}" == -* ]]; do
      case "${1}" in
        -p|-f)
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done

    case "${1:-}" in
      down)
        exit 0
        ;;
      up)
        attempts=0
        if [[ -f "${compose_up_attempts_file}" ]]; then
          attempts="$(cat "${compose_up_attempts_file}")"
        fi
        attempts=$((attempts + 1))
        printf '%s' "${attempts}" >"${compose_up_attempts_file}"
        if [[ "${attempts}" -eq 1 ]]; then
          echo "simulated compose startup failure" >&2
          exit 1
        fi
        exit 0
        ;;
      exec)
        cat <<ENV
DEFAULT_ADMIN_API_KEY=${DEFAULT_ADMIN_API_KEY:?}
PLATFORM_SERVICE_API_KEY=${PLATFORM_SERVICE_API_KEY:?}
JWT_SECRET=${JWT_SECRET:?}
WEBHOOK_ENCRYPTION_KEY=${WEBHOOK_ENCRYPTION_KEY:?}
ENV
        exit 0
        ;;
    esac
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

ENV_FILE="${TMP_DIR}/local.env"
cat >"${ENV_FILE}" <<'EOF'
DEFAULT_ADMIN_API_KEY=ab_admin_def_local_dev_123456789012345
PLATFORM_SERVICE_API_KEY=ar_service_test-service-key-123456
JWT_SECRET=test-jwt-secret
WEBHOOK_ENCRYPTION_KEY=test-webhook-secret
EOF

RUNTIME_REPO_PATH="${TMP_DIR}/runtime"
FIXTURES_REPO_PATH="${TMP_DIR}/fixtures"
PLAYBOOKS_REPO_PATH="${TMP_DIR}/playbooks"
mkdir -p "${RUNTIME_REPO_PATH}" "${FIXTURES_REPO_PATH}/.git" "${PLAYBOOKS_REPO_PATH}"

COMPOSE_UP_ATTEMPTS_FILE="${TMP_DIR}/compose-up-attempts"

COMPOSE_UP_ATTEMPTS_FILE="${COMPOSE_UP_ATTEMPTS_FILE}" \
PATH="${BIN_DIR}:${PATH}" \
LIVE_TEST_ENV_FILE="${ENV_FILE}" \
COMMUNITY_PLAYBOOKS_RESULTS_DIR="${TMP_DIR}/results" \
RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH}" \
FIXTURES_REPO_PATH="${FIXTURES_REPO_PATH}" \
PLAYBOOKS_REPO_PATH="${PLAYBOOKS_REPO_PATH}" \
bash "${SCRIPT_PATH}" >"${TMP_DIR}/stdout" 2>"${TMP_DIR}/stderr"

if [[ "$(cat "${COMPOSE_UP_ATTEMPTS_FILE}")" != "2" ]]; then
  echo "expected prepare script to retry compose up exactly once after a transient failure" >&2
  exit 1
fi
