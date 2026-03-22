#!/usr/bin/env bash
set -euo pipefail

test -f briefs/source-brief.md
test -f briefs/publication-brief.md
test -f notes/audience-signals.md

if grep -R "TODO" briefs notes >/dev/null 2>&1; then
  echo "verification failed: TODO markers remain in seeded content files" >&2
  exit 1
fi
