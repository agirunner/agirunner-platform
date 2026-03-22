#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMMON_SH="${ROOT_DIR}/tests/live/lib/common.sh"

fail() {
  echo "[tests/live/common.test] $*" >&2
  exit 1
}

test_copy_live_test_seed_tree_skips_generated_python_artifacts() {
  local tmpdir source_dir destination_dir
  tmpdir="$(mktemp -d)"
  trap "rm -rf '${tmpdir}'" EXIT
  source_dir="${tmpdir}/source"
  destination_dir="${tmpdir}/destination"
  mkdir -p "${source_dir}/pkg/__pycache__" "${source_dir}/tests/.pytest_cache" "${source_dir}/.venv/bin" "${destination_dir}"
  printf 'print("ok")\n' >"${source_dir}/pkg/module.py"
  printf 'compiled\n' >"${source_dir}/pkg/__pycache__/module.cpython-310.pyc"
  printf 'cache\n' >"${source_dir}/tests/.pytest_cache/state"
  printf 'venv\n' >"${source_dir}/.venv/bin/python"

  # shellcheck disable=SC1090
  source "${COMMON_SH}"
  copy_live_test_seed_tree "${source_dir}" "${destination_dir}"

  [[ -f "${destination_dir}/pkg/module.py" ]] || fail "expected regular source file to copy"
  [[ ! -e "${destination_dir}/pkg/__pycache__" ]] || fail "did not expect __pycache__ in copied seed"
  [[ ! -e "${destination_dir}/tests/.pytest_cache" ]] || fail "did not expect .pytest_cache in copied seed"
  [[ ! -e "${destination_dir}/.venv" ]] || fail "did not expect .venv in copied seed"
}

test_copy_live_test_seed_tree_skips_generated_python_artifacts

echo "[tests/live/common.test] PASS"
