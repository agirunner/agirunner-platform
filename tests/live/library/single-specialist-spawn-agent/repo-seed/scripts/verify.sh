#!/usr/bin/env bash
set -euo pipefail

target="deliverables/delegated-summary.md"

test -f "${target}"
grep -qi "cache invalidation" "${target}"
grep -qi "rate limiting" "${target}"
grep -qi "delegated" "${target}"
