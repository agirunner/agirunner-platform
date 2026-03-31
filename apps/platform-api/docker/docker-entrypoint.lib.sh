#!/bin/sh
set -eu

artifact_storage_backend() {
  printf '%s\n' "${ARTIFACT_STORAGE_BACKEND:-local}"
}

artifact_root() {
  printf '%s\n' "${ARTIFACT_LOCAL_ROOT:-/tmp/agirunner-platform-artifacts}"
}

current_uid() {
  id -u
}

ensure_local_artifact_root() {
  root_dir="$(artifact_root)"
  mkdir -p "${root_dir}"
  chown -R node:node "${root_dir}"
}

if ! command -v run_command >/dev/null 2>&1; then
  run_command() {
    exec "$@"
  }
fi

if ! command -v exec_as_node >/dev/null 2>&1; then
  exec_as_node() {
    su-exec node "$@"
  }
fi

main() {
  if [ "$(current_uid)" = "0" ]; then
    if [ "$(artifact_storage_backend)" = "local" ]; then
      ensure_local_artifact_root
    fi
    exec_as_node "$@"
    return 0
  fi
  run_command "$@"
}
