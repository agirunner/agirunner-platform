# CONTEXT.md — AgentBaton Platform

## Product
AgentBaton Platform — Task coordination broker for AI agents.
TypeScript / Node.js / Fastify / PostgreSQL / React.

## Repo
`enterprise/agentbaton-platform`

## Related Repos
- [agentbaton-runtime](https://github.com/agirunner/agentbaton-runtime) — Agentic Runtime (Go/Docker). Optional execution engine.
- [agentbaton-studio](https://github.com/agirunner/agentbaton-studio) — Visual pipeline builder (deferred)
- [agentbaton-marketplace](https://github.com/agirunner/agentbaton-marketplace) — Template marketplace (deferred)

## Docs Index

### Requirements
- [Product Brief](docs/requirements/product-brief.md) — Platform-specific brief
- [Platform Requirements v1.0](docs/requirements/platform-v1.0.md)
- [Usage Scenarios (API Playbook)](docs/requirements/platform-v1.0-usage-scenarios.md)
- [Platform v1.1](docs/requirements/platform-v1.1.md) (deferred)
- [Platform v1.2](docs/requirements/platform-v1.2.md) (deferred)

### Design
- [Platform Design](docs/design/platform-design.md)
- [Platform Detailed Design v1.0](docs/design/platform-v1.0-detailed.md)
- [System Architecture](docs/design/system-architecture.md) — full topology (Platform needs to understand Runtime hosting)
- [Interface Contract v1.0](docs/design/interface-contract-v1.0.md) — full Worker↔Platform + Worker↔Runtime protocols
- [Technology Selections v1.0](docs/design/technology-selections-v1.0.md) — Platform stack only (TS/Node)

### Implementation
- [Platform Implementation Plan](docs/implementation/platform-implementation-plan.md)

### Quality
- [Requirements Traceability Matrix](docs/traceability/requirements-matrix-v1.0.md) — Platform FRs, ACs, usage scenarios only (247 reqs, 74 ACs, 21 scenarios)
- [Security Review](docs/reviews/security-review-v1.0.md) — Platform findings only (11 findings)
- [Implementation Plan Review](docs/reviews/implementation-plan-review.md) — Platform review only
- [Architect Requirements Review](docs/reviews/architect-requirements-review.md)

## Development Milestones

| # | Milestone | Scope | Issue | Status |
|---|-----------|-------|-------|--------|
| A | Foundation | Scaffold, DB, config, auth, health, metrics | #1 | 🔄 In Review (PR #6, fixes in progress) |
| B | Task Lifecycle | CRUD, state machine, atomic claim, events | #2 | ⏳ Pending |
| C | Pipeline/Template | Templates, instantiation, dependency resolution, context | #3 | ⏳ Pending |
| D | Worker/Events | Registration, heartbeat, WebSocket, webhooks | #4 | ⏳ Pending |
| E | Dashboard + MCP | React SPA, MCP tools, SDKs, E2E, packaging | #5 | ⏳ Pending |

## Technology Stack (Approved)
- **Runtime:** Node.js 22 LTS
- **Framework:** Fastify 5.2
- **ORM:** Drizzle (Architect approved)
- **Database:** PostgreSQL 16
- **Dashboard:** React 18 + Vite 6 + TanStack Query 5
- **Package Manager:** pnpm (Architect approved)
- **Testing:** Vitest + testcontainers + Playwright
- **Logging:** Pino
- **Metrics:** prom-client

## Key Decisions
- 9 task states: pending, ready, claimed, running, awaiting_approval, output_pending_review, completed, failed, cancelled
- Atomic claim: SELECT FOR UPDATE SKIP LOCKED
- Runtime is OPTIONAL — platform works with external workers only
- Orchestrator is OPTIONAL per template
- REST + MCP for v1.0 (A2A deferred to v1.1)
- JWT auth for dashboard (1h access, 7d refresh), API keys for agents/workers
- Rate limiting: 100 req/min per key (NFR-012)

## Development Rules
- Test each feature as it's built — no deferred testing
- No mocks in status tracking — ✅ only when fully implemented and tested
- Update traceability matrix after every feature merge
- E2E tests cover all variations (happy + error paths per §22 error matrix)
- Every PR reviewed by Worf before merge
