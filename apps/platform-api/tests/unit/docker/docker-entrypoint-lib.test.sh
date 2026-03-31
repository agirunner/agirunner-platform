#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_API_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LIB_PATH="${PLATFORM_API_DIR}/docker/docker-entrypoint.lib.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

test_root_startup_normalizes_artifact_root_and_drops_privileges() {
  local tmpdir log_file artifact_root
  tmpdir="$(mktemp -d)"
  log_file="${tmpdir}/calls.log"
  artifact_root="${tmpdir}/artifacts"
  export ARTIFACT_LOCAL_ROOT="${artifact_root}"

  id() { echo 0; }
  chown() { printf 'chown:%s\n' "$*" >>"${log_file}"; }
  exec_as_node() { printf 'su-exec:node %s\n' "$*" >>"${log_file}"; }

  # shellcheck disable=SC1090
  source "${LIB_PATH}"
  main node dist/src/index.js

  [[ -d "${artifact_root}" ]] || fail "artifact root was not created"
  grep -F "chown:-R node:node ${artifact_root}" "${log_file}" >/dev/null \
    || fail "expected recursive chown"
  grep -F "su-exec:node node dist/src/index.js" "${log_file}" >/dev/null \
    || fail "expected privilege drop via su-exec"
}

test_non_root_startup_executes_command_directly() {
  local tmpdir log_file artifact_root
  tmpdir="$(mktemp -d)"
  log_file="${tmpdir}/calls.log"
  artifact_root="${tmpdir}/artifacts"
  export ARTIFACT_LOCAL_ROOT="${artifact_root}"

  id() { echo 1000; }
  chown() { printf 'chown:%s\n' "$*" >>"${log_file}"; }
  exec_as_node() { printf 'su-exec:node %s\n' "$*" >>"${log_file}"; }
  run_command() { printf 'exec:%s\n' "$*" >>"${log_file}"; }

  # shellcheck disable=SC1090
  source "${LIB_PATH}"
  main node dist/src/index.js

  grep -F "exec:node dist/src/index.js" "${log_file}" >/dev/null \
    || fail "expected direct exec for non-root startup"
  if [[ -f "${log_file}" ]] && grep -F "chown:" "${log_file}" >/dev/null; then
    fail "did not expect chown on non-root startup"
  fi
}

test_root_startup_normalizes_artifact_root_and_drops_privileges
test_non_root_startup_executes_command_directly
