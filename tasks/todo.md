# Milestone D — Worker Connection & Events Plan

## Blocking Findings Remediation Plan (PR #11)
- [x] Read MEMORY.md and CONTEXT.md
- [x] Refactor `worker-service.ts` into focused modules (`worker-registration-service.ts`, `worker-heartbeat-service.ts`, `worker-dispatch-service.ts`, `worker-signal-service.ts`, `webhook-delivery.ts`)
- [x] Replace webhook signature verification with timing-safe comparison + add regression test
- [x] Fix webhook subscription for multi-tenant delivery + add integration coverage for tenant isolation
- [x] Add configurable offline worker grace period before task reassignment + add test with before/after behavior
- [x] Move operational literals to config schema/env (timeouts, retries, backoff, ping/scheduler cadences, ws path)
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json + memory log
- [x] Commit and push to `feature/milestone-d`


- [x] Read MEMORY.md + CONTEXT.md and milestone D requirement/design docs
- [x] Create branch `feature/milestone-d` from `main`
- [x] Add DB migration(s) and schema updates for Milestone D entities/fields (workers, webhooks, dispatch tracking if needed)
- [x] Implement Worker service + routes:
  - [x] `POST /api/v1/workers/register`
  - [x] `GET /api/v1/workers`
  - [x] `GET /api/v1/workers/:id`
  - [x] `DELETE /api/v1/workers/:id`
  - [x] `POST /api/v1/workers/:id/heartbeat`
  - [x] `POST /api/v1/workers/:id/signal`
- [x] Implement task dispatch algorithm updates (capability matching + least-loaded online worker + assignment ack timeout handling)
- [x] Implement WebSocket endpoint `/api/v1/ws` for authenticated worker sessions + server push + worker ACK/progress/log/status messages
- [x] Implement SSE event stream endpoint `GET /api/v1/events/stream` with filters (event type/project/pipeline)
- [x] Implement PG LISTEN/NOTIFY bridge for event fan-out (SSE + WS)
- [x] Implement webhook subscription + delivery system:
  - [x] `POST /api/v1/webhooks`
  - [x] `GET /api/v1/webhooks`
  - [x] `DELETE /api/v1/webhooks/:id`
  - [x] HMAC-SHA256 signatures + retry/backoff + event-type filtering
- [x] Extend lifecycle monitor for worker heartbeat timeout/offline transition and stale task recovery
- [x] Add unit tests (worker state machine, dispatch algorithm, webhook HMAC)
- [x] Add integration tests (WS dispatch, SSE streaming, webhook delivery/signature, heartbeat timeout)
- [x] Add e2e test (full worker lifecycle + webhook end-to-end)
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json and memory log
- [x] Commit, push branch, open PR against `main`

## PR #11 Follow-up — Remove remaining hardcoded operational values
- [x] Read MEMORY.md and CONTEXT.md
- [x] Externalize AgentService defaults/timers into `config/schema.ts`
- [x] Externalize TaskService + pipeline instantiation timeout default into shared `TASK_DEFAULT_TIMEOUT_MINUTES`
- [x] Grep `services/`, `jobs/`, `orchestration/` for remaining hardcoded operational values and remediate
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json and memory log
- [x] Commit and push to `feature/milestone-d`
