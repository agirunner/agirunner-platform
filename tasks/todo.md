# Milestone E — Review Findings Remediation (PR #17)

- [x] Audit current implementations for the 5 review findings and affected tests
- [x] Fix dashboard auth token handling: memory-only access token, cookie refresh flow, and regression test for localStorage
- [x] Fix SDK realtime auth transport: no token in URL/protocol for SSE/WS and add regression tests
- [x] Refactor MCP server for SRP split and add robust JSON parse + tool input validation
- [x] Add API CORS plugin/config (`CORS_ORIGIN`, credentials) and preflight header test
- [x] Run `pnpm test && pnpm lint`, resolve failures, and verify changed files stay within size constraints
- [x] Update STATUS.json + memory log, commit, and push to `feature/milestone-e`
