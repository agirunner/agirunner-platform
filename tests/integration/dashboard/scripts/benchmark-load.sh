#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

cd "${REPO_ROOT}"
export ARTIFACT_LOCAL_ROOT="${ARTIFACT_LOCAL_ROOT:-${REPO_ROOT}/tmp/integration-artifacts}"
corepack pnpm exec tsx tests/integration/dashboard/lib/benchmark-load.ts "$@"
