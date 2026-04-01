#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/release-tags.sh"

assert_equals() {
  local actual="$1"
  local expected="$2"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "expected: ${expected}" >&2
    echo "actual:   ${actual}" >&2
    exit 1
  fi
}

assert_fails() {
  if "$@" >/tmp/platform-release-tags-test.out 2>/tmp/platform-release-tags-test.err; then
    echo "expected command to fail: $*" >&2
    exit 1
  fi
}

assert_equals "$(bash "${SCRIPT_PATH}" validate-git-tag v0.1.0-alpha.1)" "0.1.0-alpha.1"
assert_equals "$(bash "${SCRIPT_PATH}" validate-git-tag v0.1.0)" "0.1.0"
assert_equals "$(bash "${SCRIPT_PATH}" validate-image-tag 0.1.0-beta.2)" "0.1.0-beta.2"
assert_equals "$(bash "${SCRIPT_PATH}" validate-image-tag 0.1.0)" "0.1.0"

assert_equals "$(bash "${SCRIPT_PATH}" publish-tags-from-git-tag v0.1.0-rc.1)" $'0.1.0-rc.1\nlatest'
assert_equals "$(bash "${SCRIPT_PATH}" publish-tags-from-image-tag 0.1.0-beta.1)" $'0.1.0-beta.1\nlatest'
assert_equals "$(bash "${SCRIPT_PATH}" publish-tags-from-git-tag v0.1.0)" $'0.1.0\nlatest'
assert_equals "$(bash "${SCRIPT_PATH}" publish-tags-from-image-tag 0.1.0)" $'0.1.0\nlatest'

assert_fails bash "${SCRIPT_PATH}" validate-git-tag v0.1.0-a.1
assert_fails bash "${SCRIPT_PATH}" validate-git-tag 0.1.0
assert_fails bash "${SCRIPT_PATH}" validate-image-tag latest
assert_fails bash "${SCRIPT_PATH}" validate-image-tag 0.1
