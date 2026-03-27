#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LIVE_TEST_ROOT}/../.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

usage() {
  cat <<'EOF'
Usage:
  bash tests/live/run.sh
  bash tests/live/run.sh --scenario <name|path>
  bash tests/live/run.sh --failed-only
  bash tests/live/run.sh --concurrency <n>
  bash tests/live/run.sh --bootstrap-only
  bash tests/live/run.sh --prepare-only --scenario <name|path>
  bash tests/live/run.sh --normalize-oauth-session [--oauth-session-out <path>]
EOF
}

normalize_oauth_session() {
  local output_file="$1"
  local session_json

  require_live_test_value "LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID" "${LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID:-}"
  require_live_test_value "LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON" "${LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON:-}"

  session_json="$(
    python3 - <<'PY'
import json
import os

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

  if [[ -n "${output_file}" ]]; then
    mkdir -p "$(dirname "${output_file}")"
    printf '%s\n' "${session_json}" >"${output_file}"
    log_live_test "wrote oauth session snapshot to ${output_file}"
    return 0
  fi

  printf '%s\n' "${session_json}"
}

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT="${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/scripts/prepare-live-test-shared-environment.sh}"
LIVE_TEST_BOOTSTRAP_SCRIPT="${LIVE_TEST_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/scripts/prepare-live-test-run.sh}"
LIVE_TEST_SCENARIO_RUNNER="${LIVE_TEST_SCENARIO_RUNNER:-${LIVE_TEST_ROOT}/scripts/run-live-scenario.sh}"
LIVE_TEST_BATCH_RUNNER="${LIVE_TEST_BATCH_RUNNER:-${LIVE_TEST_ROOT}/scripts/run-live-scenario-batch.sh}"
LIVE_TEST_MULTI_ORCHESTRATOR_RUNNER="${LIVE_TEST_MULTI_ORCHESTRATOR_RUNNER:-${LIVE_TEST_ROOT}/scripts/run-multi-orchestrator-concurrent-assessment-workflows-live-test.sh}"
LIVE_TEST_ARTIFACTS_DIR="${LIVE_TEST_ARTIFACTS_DIR:-$(default_live_test_artifacts_dir)}"
LIVE_TEST_SHARED_CONTEXT_FILE="${LIVE_TEST_SHARED_CONTEXT_FILE:-${LIVE_TEST_ARTIFACTS_DIR}/bootstrap/context.json}"
PLATFORM_API_BASE_URL="${PLATFORM_API_BASE_URL:-http://127.0.0.1:${PLATFORM_API_PORT:-8080}}"
LIVE_TEST_REMOTE_MCP_FIXTURE_URL="${LIVE_TEST_REMOTE_MCP_FIXTURE_URL:-http://127.0.0.1:${LIVE_TEST_REMOTE_MCP_FIXTURE_PORT:-18080}/health}"

scenario_arg=""
oauth_session_out=""
failed_only="false"
bootstrap_only="false"
prepare_only="false"
normalize_only="false"
concurrency=""
declare -a batch_scenarios=()

while (( $# > 0 )); do
  case "$1" in
    --scenario)
      if (( $# < 2 )); then
        echo "[tests/live] --scenario requires a value" >&2
        exit 1
      fi
      scenario_arg="$2"
      shift 2
      ;;
    --failed-only)
      failed_only="true"
      shift
      ;;
    --concurrency)
      if (( $# < 2 )); then
        echo "[tests/live] --concurrency requires a value" >&2
        exit 1
      fi
      concurrency="$2"
      shift 2
      ;;
    --bootstrap-only)
      bootstrap_only="true"
      shift
      ;;
    --prepare-only)
      prepare_only="true"
      shift
      ;;
    --normalize-oauth-session)
      normalize_only="true"
      shift
      ;;
    --oauth-session-out)
      if (( $# < 2 )); then
        echo "[tests/live] --oauth-session-out requires a value" >&2
        exit 1
      fi
      oauth_session_out="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while (( $# > 0 )); do
        batch_scenarios+=("$1")
        shift
      done
      ;;
    *)
      batch_scenarios+=("$1")
      shift
      ;;
  esac
done

load_live_test_env "${LIVE_TEST_ENV_FILE}"

if [[ "${normalize_only}" == "true" ]]; then
  if [[ "${bootstrap_only}" == "true" || "${prepare_only}" == "true" || -n "${scenario_arg}" || "${failed_only}" == "true" || -n "${concurrency}" || ${#batch_scenarios[@]} -gt 0 ]]; then
    echo "[tests/live] --normalize-oauth-session cannot be combined with run options" >&2
    exit 1
  fi
  normalize_oauth_session "${oauth_session_out}"
  exit 0
fi

if [[ -n "${oauth_session_out}" ]]; then
  echo "[tests/live] --oauth-session-out requires --normalize-oauth-session" >&2
  exit 1
fi

if [[ "${bootstrap_only}" == "true" && "${prepare_only}" == "true" ]]; then
  echo "[tests/live] --bootstrap-only and --prepare-only cannot be combined" >&2
  exit 1
fi

if [[ "${prepare_only}" == "true" && -z "${scenario_arg}" ]]; then
  echo "[tests/live] --prepare-only requires --scenario" >&2
  exit 1
fi

if [[ -n "${scenario_arg}" && ( "${failed_only}" == "true" || -n "${concurrency}" || ${#batch_scenarios[@]} -gt 0 ) ]]; then
  echo "[tests/live] --scenario cannot be combined with batch-only options" >&2
  exit 1
fi

if [[ "${bootstrap_only}" == "true" ]]; then
  require_live_test_file "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}" "shared live test bootstrap script"
  resolve_live_test_shared_bootstrap_key "${LIVE_TEST_ROOT}" "${REPO_ROOT}" >/dev/null
  exec "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}"
fi

if [[ "${prepare_only}" == "true" ]]; then
  require_live_test_file "${LIVE_TEST_BOOTSTRAP_SCRIPT}" "live test bootstrap script"
  ensure_live_test_shared_bootstrap \
    "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}" \
    "${LIVE_TEST_SHARED_CONTEXT_FILE}" \
    "${PLATFORM_API_BASE_URL}" \
    "${LIVE_TEST_REMOTE_MCP_FIXTURE_URL}" \
    "${LIVE_TEST_ROOT}" \
    "${REPO_ROOT}"
  exec "${LIVE_TEST_BOOTSTRAP_SCRIPT}" "${scenario_arg}"
fi

if [[ -n "${scenario_arg}" ]]; then
  if [[ "${scenario_arg}" == "multi-orchestrator-concurrent-assessment-workflows" ]]; then
    require_live_test_file "${LIVE_TEST_MULTI_ORCHESTRATOR_RUNNER}" "multi orchestrator live test runner"
    exec "${LIVE_TEST_MULTI_ORCHESTRATOR_RUNNER}"
  fi
  require_live_test_file "${LIVE_TEST_SCENARIO_RUNNER}" "live test scenario runner"
  ensure_live_test_shared_bootstrap \
    "${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT}" \
    "${LIVE_TEST_SHARED_CONTEXT_FILE}" \
    "${PLATFORM_API_BASE_URL}" \
    "${LIVE_TEST_REMOTE_MCP_FIXTURE_URL}" \
    "${LIVE_TEST_ROOT}" \
    "${REPO_ROOT}"
  exec "${LIVE_TEST_SCENARIO_RUNNER}" "${scenario_arg}"
fi

require_live_test_file "${LIVE_TEST_BATCH_RUNNER}" "live test batch runner"
declare -a batch_args=()
if [[ "${failed_only}" == "true" ]]; then
  batch_args+=("--failed-only")
fi
if [[ -n "${concurrency}" ]]; then
  batch_args+=("${concurrency}")
fi
if (( ${#batch_scenarios[@]} > 0 )); then
  batch_args+=("${batch_scenarios[@]}")
fi
exec "${LIVE_TEST_BATCH_RUNNER}" "${batch_args[@]}"
