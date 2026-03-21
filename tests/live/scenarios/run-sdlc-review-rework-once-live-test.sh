#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${LIVE_TEST_ROOT}/scenarios/run-live-scenario.sh" "${LIVE_TEST_SCENARIO_NAME:-sdlc-review-rework-once}" "$@"
