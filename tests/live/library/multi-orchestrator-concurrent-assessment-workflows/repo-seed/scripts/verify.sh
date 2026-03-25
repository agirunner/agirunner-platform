#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: ./scripts/verify.sh <deliverable-path>" >&2
  exit 2
fi

target="$1"
if [[ ! -f "$target" ]]; then
  echo "missing deliverable: $target" >&2
  exit 1
fi

python3 - "$target" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
content = target.read_text(encoding="utf-8")
if content != "hi back\n":
    raise SystemExit(f"unexpected content in {target}: {content!r}")
PY
