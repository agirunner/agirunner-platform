#!/usr/bin/env sh
set -eu

name="${1:-world}"

if [ "$#" -gt 1 ]; then
  echo "usage: greet.sh [name]" >&2
  exit 1
fi

if [ "${name}" = "world" ]; then
  printf '%s\n' 'Hello, world!'
  exit 0
fi

printf 'Hello %s!\n' "${name}"
