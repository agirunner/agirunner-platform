#!/usr/bin/env bash
set -euo pipefail

output="$(sh greet.sh)"

if [[ "${output}" != "Hello, world!" ]]; then
  echo "expected 'Hello, world!' but got '${output}'" >&2
  exit 1
fi

echo "ok"
