#!/usr/bin/env bash
set -euo pipefail

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-live-scenario.sh" same-subject-role-different-assessors
