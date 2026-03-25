#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${LIVE_TEST_ROOT}/../.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
load_live_test_env "${LIVE_TEST_ENV_FILE}"

DEFAULT_CONCURRENCY=5
concurrency="${LIVE_TEST_MAX_CONCURRENT_SCENARIOS:-${DEFAULT_CONCURRENCY}}"
failed_only="${LIVE_TEST_FAILED_ONLY_RERUNS:-false}"

while (( $# > 0 )); do
  case "$1" in
    --failed-only)
      failed_only="true"
      shift
      ;;
    *)
      break
      ;;
  esac
done

if (( $# > 0 )) && [[ "$1" =~ ^[0-9]+$ ]]; then
  concurrency="$1"
  shift
fi

scenario_root="${LIVE_TEST_SCENARIO_ROOT:-${LIVE_TEST_SCENARIO_DIR:-${LIVE_TEST_ROOT}/scenarios}}"
default_tracker_file="${LIVE_TEST_ROOT}/live_test_tracker.json"
if [[ -n "${LIVE_TEST_TRACKER_FILE:-}" ]]; then
  tracker_file="${LIVE_TEST_TRACKER_FILE}"
elif [[ "${scenario_root}" == "${LIVE_TEST_ROOT}/scenarios" ]]; then
  tracker_file="${default_tracker_file}"
else
  tracker_file=""
fi
shared_bootstrap_script="${LIVE_TEST_SHARED_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/prepare-live-test-shared-environment.sh}"
scenario_runner="${LIVE_TEST_SCENARIO_RUNNER:-${LIVE_TEST_ROOT}/scenarios/run-live-scenario.sh}"
scenario_bootstrap_script="${LIVE_TEST_BOOTSTRAP_SCRIPT:-${LIVE_TEST_ROOT}/prepare-live-test-run.sh}"
artifacts_dir="${LIVE_TEST_ARTIFACTS_DIR:-${REPO_ROOT}/.tmp/live-tests}"
shared_context_file="${LIVE_TEST_SHARED_CONTEXT_FILE:-${artifacts_dir}/bootstrap/context.json}"
batch_artifacts_dir="${artifacts_dir}/batch"

mkdir -p "${batch_artifacts_dir}"
require_live_test_dir "${scenario_root}" "live test scenario directory"
require_live_test_file "${shared_bootstrap_script}" "shared live test bootstrap script"
require_live_test_file "${scenario_runner}" "scenario runner"
require_live_test_file "${scenario_bootstrap_script}" "scenario bootstrap script"

declare -a scenarios=()
if (( $# > 0 )); then
  scenarios=("$@")
elif [[ "${failed_only}" == "true" ]]; then
  while IFS= read -r scenario_name; do
    [[ -n "${scenario_name}" ]] || continue
    scenarios+=("${scenario_name}")
  done < <(list_live_test_failing_scenarios "${scenario_root}" "${artifacts_dir}" "${tracker_file}")
else
  while IFS= read -r scenario_name; do
    [[ -n "${scenario_name}" ]] || continue
    scenarios+=("${scenario_name}")
  done < <(list_live_test_supported_scenarios "${scenario_root}" "${tracker_file}")
fi

if (( ${#scenarios[@]} == 0 )); then
  if [[ "${failed_only}" == "true" ]]; then
    log_live_test "No failing scenarios found for rerun"
    exit 0
  fi
  echo "[tests/live] no scenarios found in ${scenario_root}" >&2
  exit 1
fi

log_live_test "Running live scenarios with concurrency=${concurrency}"
bash "${shared_bootstrap_script}"

declare -A pid_to_scenario=()
declare -A pid_to_log=()
declare -a active_pids=()
passed=0
failed=0
completed=0
next_index=0

launch_scenario() {
  local scenario="$1"
  local scenario_label="${scenario}"
  if [[ -f "${scenario_label}" ]]; then
    scenario_label="$(basename "${scenario_label}" .json)"
  fi
  local log_file="${batch_artifacts_dir}/${scenario_label}.log"
  local scenario_arg="${scenario}"
  if [[ ! -f "${scenario_arg}" && -f "${scenario_root}/${scenario}.json" ]]; then
    scenario_arg="${scenario_root}/${scenario}.json"
  fi
  rm -f "${log_file}"
  (
    env -u LIVE_TEST_SCENARIO_DIR \
      LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE}" \
      LIVE_TEST_ARTIFACTS_DIR="${artifacts_dir}" \
      LIVE_TEST_SHARED_CONTEXT_FILE="${shared_context_file}" \
      LIVE_TEST_BOOTSTRAP_SCRIPT="${scenario_bootstrap_script}" \
      "${scenario_runner}" "${scenario_arg}"
  ) >"${log_file}" 2>&1 &
  local pid=$!
  pid_to_scenario["${pid}"]="${scenario_label}"
  pid_to_log["${pid}"]="${log_file}"
  active_pids+=("${pid}")
}

collect_finished_scenario() {
  local pid="$1"
  local scenario="${pid_to_scenario[${pid}]}"
  local log_file="${pid_to_log[${pid}]}"
  local status

  set +e
  wait "${pid}"
  status=$?
  set -e

  completed=$((completed + 1))
  if (( status == 0 )); then
    passed=$((passed + 1))
    log_live_test "PASS ${scenario}"
  else
    failed=$((failed + 1))
    log_live_test "FAIL ${scenario}"
  fi
  if [[ -f "${log_file}" ]]; then
    cat "${log_file}"
  fi
  unset 'pid_to_scenario[$pid]'
  unset 'pid_to_log[$pid]'
}

while (( next_index < ${#scenarios[@]} || ${#active_pids[@]} > 0 )); do
  while (( next_index < ${#scenarios[@]} && ${#active_pids[@]} < concurrency )); do
    launch_scenario "${scenarios[${next_index}]}"
    next_index=$((next_index + 1))
  done

  finished_pid=""
  for pid in "${active_pids[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      finished_pid="${pid}"
      break
    fi
  done

  if [[ -z "${finished_pid}" ]]; then
    sleep 0.1
    continue
  fi

  collect_finished_scenario "${finished_pid}"
  remaining_pids=()
  for pid in "${active_pids[@]}"; do
    if [[ "${pid}" != "${finished_pid}" ]]; then
      remaining_pids+=("${pid}")
    fi
  done
  active_pids=("${remaining_pids[@]}")
done

log_live_test "Completed ${completed} scenario(s): ${passed} passed, ${failed} failed"
IFS=$'\t' read -r matrix_passed matrix_remaining matrix_total < <(
  count_live_test_matrix_status "${scenario_root}" "${artifacts_dir}"
)
log_live_test "Matrix status: ${matrix_passed} passed, ${matrix_remaining} remaining, ${matrix_total} total"
if (( failed > 0 )); then
  exit 1
fi
