# Milestone B — Review Findings Fix Plan (PR #9)

- [x] Read MEMORY.md and CONTEXT.md
- [x] Fix lifecycle endpoint authorization (IDOR): enforce calling agent ownership in start/complete/fail
- [x] Remove invalid state transition `running -> awaiting_approval`
- [x] Add heartbeat grace period config + enforcement logic (`HEARTBEAT_GRACE_PERIOD_MS`, default 300000)
- [x] Add/adjust tests:
  - [x] Agent A claims task, Agent B complete attempt returns 403
  - [x] State machine tests updated for removed transition
  - [x] Heartbeat timeout does not fail tasks until grace period expires
  - [x] Dependency cascade A→B→C readiness progression
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json and memory log
- [x] Commit and push to `feature/milestone-b`
