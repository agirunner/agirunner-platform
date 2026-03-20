#!/usr/bin/env bash
set -euo pipefail

default_output="$(sh greet.sh)"
if [[ "${default_output}" != "Hello, world!" ]]; then
  echo "expected 'Hello, world!' but got '${default_output}'" >&2
  exit 1
fi

named_output="$(sh greet.sh Mark)"
if [[ "${named_output}" != "Hello Mark!" ]]; then
  echo "expected 'Hello Mark!' but got '${named_output}'" >&2
  exit 1
fi

echo "ok"
