#!/usr/bin/env bash
set -euo pipefail

target_chunk="${1:-}"

if [[ -z "${target_chunk}" ]]; then
  echo "usage: ./scripts/verify.sh <chunk-id>" >&2
  exit 1
fi

target="deliverables/${target_chunk}.txt"
test -f "${target}"
grep -q "hi back" "${target}"
