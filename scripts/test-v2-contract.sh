#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/apps/platform-api"
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm exec vitest run \
  tests/unit/playbook-workflow.integration.test.ts \
  tests/unit/continuous-work-item-activation.integration.test.ts \
  tests/unit/escalation-roundtrip.integration.test.ts \
  tests/unit/v2-reset-setup.integration.test.ts \
  tests/unit/workflow-activation-dispatch-service.test.ts \
  tests/unit/workflow-tool-result-service.test.ts \
  tests/unit/task-lifecycle-service.test.ts \
  tests/unit/task-claim-service.test.ts \
  tests/unit/task-write-service.test.ts \
  tests/unit/work-item-service.test.ts \
  tests/unit/project-timeline-service.test.ts \
  --reporter=dot

cd "$ROOT_DIR/apps/dashboard"
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm exec vitest run \
  src/pages/workflow-detail-page.test.ts \
  src/pages/workflow-detail-sections.test.ts \
  src/pages/work/approval-queue-page.test.ts \
  src/pages/mission-control/live-board-page.test.ts \
  src/pages/projects/project-content-browser-support.test.ts \
  src/pages/projects/project-memory-support.test.ts \
  src/pages/task-detail-page.test.ts \
  src/pages/work/task-detail-page.test.ts \
  src/pages/work/task-list-page.test.ts \
  --reporter=dot

cd "$ROOT_DIR/packages/sdk"
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm exec vitest run src/client.test.ts src/client-full.test.ts --reporter=dot
