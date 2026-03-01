# Test Backfill Plan — feature/test-backfill

## Scope
Backfill dedicated, meaningful automated tests for all undertested (`⚠️`) features tracked in `docs/requirements-matrix-v1.0.md`, with explicit focus on Dashboard/Auth, MCP server, SDK, webhook, pipeline, worker, and template edge cases.

## Execution Plan
- [x] Inventory every `⚠️` requirement in `docs/requirements-matrix-v1.0.md` and map each to a concrete test case file
- [x] Backfill auth/dashboard tests (JWT refresh, refresh expiry redirect, secure cookie flags)
- [x] Backfill MCP tests for all 8 tools, per-tool error responses, and JSON-RPC edge cases
- [x] Backfill SDK tests (SSE reconnect, WS auth-first-frame, API error mapping, pagination helper)
- [x] Backfill webhook tests (invalid HMAC, timeout behavior, retry exhaustion marking failed)
- [x] Backfill pipeline/template tests (cancel during resolution, parameter type expansion, mixed terminal state derivation, version preservation, cycle rejection, optional params)
- [x] Backfill worker tests (offline grace requeue, heartbeat timeout detection, concurrent claim race)
- [ ] Cover remaining `⚠️` requirements with focused tests and explicit assertions
- [x] Run quality gates: `pnpm build && pnpm test && pnpm lint`
- [ ] Update STATUS.json + lesson log (if needed), commit, push branch, open PR
