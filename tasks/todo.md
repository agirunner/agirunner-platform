# TODO — PR #54 blocker fixes

- [ ] Fix runner `--all` matrix expansion logic in `tests/live/harness/runner.ts`
- [ ] Expand OT-2 routing scenarios (superset match, one-claim-limit, strict no-match failure) in `tests/live/scenarios/ot2-task-routing.ts`
- [ ] Expand OT-3 pipeline-state scenarios (`any running`, mixed-terminal derivation) in `tests/live/scenarios/ot3-pipeline-state.ts`
- [ ] Expand IT-2 MCP JSON-RPC coverage and strict error-code assertions in `tests/live/scenarios/it2-mcp.ts`
- [ ] Expand SI-1 tenant isolation scenarios (cross-tenant 404, deactivated 403, SSE isolation) in `tests/live/scenarios/si1-tenant-isolation.ts`
- [ ] Tighten AP-5 maintenance pipeline assertions for output content correctness in `tests/live/scenarios/ap5-maintenance-pipeline.ts`
- [ ] Run `pnpm install && pnpm build && pnpm test`
- [ ] Commit each blocker fix atomically and push branch
