#!/usr/bin/env bash

log_live_test() {
  echo "[tests/live] $*"
}

require_live_test_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "${path}" ]]; then
    echo "[tests/live] ${label} not found: ${path}" >&2
    exit 1
  fi
}

require_live_test_dir() {
  local path="$1"
  local label="$2"
  if [[ ! -d "${path}" ]]; then
    echo "[tests/live] ${label} not found: ${path}" >&2
    exit 1
  fi
}

require_live_test_value() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "[tests/live] ${name} is required" >&2
    exit 1
  fi
}

load_live_test_env() {
  local env_file="$1"
  require_live_test_file "${env_file}" "live test env file"
  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

derive_live_test_database_url() {
  echo "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
}

wait_for_live_test_http() {
  local url="$1"
  local label="$2"
  local max_attempts="${3:-60}"
  local sleep_seconds="${4:-2}"
  local attempt=1

  if command -v curl >/dev/null 2>&1; then
    while (( attempt <= max_attempts )); do
      if curl --fail --silent --show-error "${url}" >/dev/null; then
        return 0
      fi
      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done
  elif command -v wget >/dev/null 2>&1; then
    while (( attempt <= max_attempts )); do
      if wget -qO- "${url}" >/dev/null; then
        return 0
      fi
      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done
  else
    echo "[tests/live] curl or wget is required to probe ${label}" >&2
    exit 1
  fi

  echo "[tests/live] timed out waiting for ${label}: ${url}" >&2
  exit 1
}
