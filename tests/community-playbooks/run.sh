#!/usr/bin/env bash
set -euo pipefail

SUITE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SUITE_ROOT}/../.." && pwd)"
LIVE_ROOT="${REPO_ROOT}/tests/live"

# shellcheck disable=SC1091
source "${LIVE_ROOT}/lib/common.sh"

usage() {
  cat <<'EOF'
Usage:
  bash tests/community-playbooks/run.sh
  bash tests/community-playbooks/run.sh --bootstrap-only
  bash tests/community-playbooks/run.sh --import-only
  bash tests/community-playbooks/run.sh --batch <smoke|matrix|controls>
  bash tests/community-playbooks/run.sh --playbook <slug>
  bash tests/community-playbooks/run.sh --variant <id>
  bash tests/community-playbooks/run.sh --manual-operator-actions
  bash tests/community-playbooks/run.sh --failed-only
EOF
}

SUITE_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_ROOT}/env/local.env}"
load_live_test_env "${SUITE_ENV_FILE}"
export PLATFORM_API_BASE_URL="${PLATFORM_API_BASE_URL:-http://127.0.0.1:${PLATFORM_API_PORT:-8080}}"
export DASHBOARD_BASE_URL="${DASHBOARD_BASE_URL:-http://127.0.0.1:${DASHBOARD_PORT:-3000}}"
export LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET="${LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET:-live-test-parameterized-secret}"

args=("$@")

if (( ${#args[@]} > 0 )); then
  for ((i=0; i<${#args[@]}; i++)); do
    case "${args[$i]}" in
      -h|--help)
        usage
        exit 0
        ;;
      --batch)
        if (( i + 1 >= ${#args[@]} )); then
          echo "[tests/community-playbooks] --batch requires a value" >&2
          exit 1
        fi
        case "${args[$((i + 1))]}" in
          smoke|matrix|controls) ;;
          *)
            echo "[tests/community-playbooks] unsupported batch: ${args[$((i + 1))]}" >&2
            exit 1
            ;;
        esac
        ;;
    esac
  done
fi

export COMMUNITY_PLAYBOOKS_SUITE_ROOT="${SUITE_ROOT}"
export COMMUNITY_PLAYBOOKS_RESULTS_DIR="${COMMUNITY_PLAYBOOKS_RESULTS_DIR:-${SUITE_ROOT}/results}"

exec python3 "${SUITE_ROOT}/lib/runner.py" "${args[@]}"
