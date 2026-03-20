#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  printf '%s\n' 'Hello, world!'
  exit 0
fi

printf 'Hello %s!\n' "$1"
