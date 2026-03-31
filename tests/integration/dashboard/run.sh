#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SUITE_DIR="$ROOT_DIR/tests/integration/dashboard"
cd "$ROOT_DIR"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

count_runtime_specialists() {
  docker ps --format '{{.Names}}' | grep -c '^runtime-speciali' || true
}

read_workflow_activation_count() {
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
  PGPASSWORD="${POSTGRES_PASSWORD}" \
    psql \
      -h "${POSTGRES_HOST:-127.0.0.1}" \
      -p "${POSTGRES_PORT}" \
      -U "${POSTGRES_USER}" \
      -d "${POSTGRES_DB}" \
      -tAc "select count(*) from workflow_activations wa join workflows w on w.id = wa.workflow_id where w.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid and coalesce(w.name, '') like 'E2E %';" \
    | tr -d '[:space:]'
}

clear_fixture_workflow_activations() {
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
  PGPASSWORD="${POSTGRES_PASSWORD}" \
    psql \
      -h "${POSTGRES_HOST:-127.0.0.1}" \
      -p "${POSTGRES_PORT}" \
      -U "${POSTGRES_USER}" \
      -d "${POSTGRES_DB}" \
      -tAc "delete from workflow_activations where workflow_id in (select id from workflows where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid and coalesce(name, '') like 'E2E %');" \
    >/dev/null
}

assert_no_runtime_specialists() {
  local runtime_count
  runtime_count="$(count_runtime_specialists)"
  if [[ "$runtime_count" != "0" ]]; then
    echo "Non-live integration guard failed: runtime specialist containers are active." >&2
    exit 1
  fi
}

normalize_spec_arg() {
  local arg="$1"
  local relative_path
  if [[ "$arg" == "$SUITE_DIR/"* ]]; then
    relative_path="${arg#"$SUITE_DIR/"}"
    printf '%s\n' "$relative_path"
    return 0
  fi
  if [[ "$arg" == "tests/integration/dashboard/"* ]]; then
    relative_path="${arg#"tests/integration/dashboard/"}"
    printf '%s\n' "$relative_path"
    return 0
  fi
  printf '%s\n' "$arg"
}

require_tool docker
require_tool psql
require_tool corepack

assert_no_runtime_specialists
clear_fixture_workflow_activations
before_activation_count="$(read_workflow_activation_count)"

export PLAYWRIGHT_SKIP_WEBSERVER="${PLAYWRIGHT_SKIP_WEBSERVER:-1}"
playwright_args=()
for arg in "$@"; do
  playwright_args+=("$(normalize_spec_arg "$arg")")
done
corepack pnpm exec playwright test -c apps/dashboard/playwright.config.ts "${playwright_args[@]}"

clear_fixture_workflow_activations
after_activation_count="$(read_workflow_activation_count)"
assert_no_runtime_specialists

if [[ "$after_activation_count" != "$before_activation_count" ]]; then
  echo "Non-live integration guard failed: workflow_activations changed during the run." >&2
  echo "Before: $before_activation_count" >&2
  echo "After:  $after_activation_count" >&2
  exit 1
fi
