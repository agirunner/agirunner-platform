# CONTEXT.md — AgentBaton Platform

## Product
AgentBaton Platform — Task coordination broker for AI agents.
TypeScript / Node.js / Fastify / PostgreSQL / React.

## Repo
`enterprise/agentbaton-platform`

## Related Repo
- [agentbaton-runtime](https://github.com/agirunner/agentbaton-runtime) — Agentic Runtime (Go/Docker). Optional execution engine. Platform works standalone with external workers.

## Docs Index

### Requirements
- [Platform Requirements v1.0](docs/requirements/platform-v1.0.md)
- [Usage Scenarios (API Playbook)](docs/requirements/platform-v1.0-usage-scenarios.md)
- [Product Brief](docs/requirements/product-brief.md)

### Design
- [Platform Design](docs/design/platform-design.md)
- [Platform Detailed Design v1.0](docs/design/platform-v1.0-detailed.md)
- [System Architecture](docs/design/system-architecture.md)
- [Interface Contract v1.0](docs/design/interface-contract-v1.0.md) — Worker↔Platform and Worker↔Runtime protocols
- [Technology Selections v1.0](docs/design/technology-selections-v1.0.md)

### Implementation
- [Platform Implementation Plan](docs/implementation/platform-implementation-plan.md)

### Quality
- [Requirements Traceability Matrix](docs/traceability/requirements-matrix-v1.0.md)
- [Security Review](docs/reviews/security-review-v1.0.md)
- [Implementation Plan Review](docs/reviews/implementation-plan-review.md)

### Deferred
- [Platform v1.1](docs/requirements/platform-v1.1.md)
- [Platform v1.2](docs/requirements/platform-v1.2.md)

## Development Milestones

| # | Milestone | Scope | Issue | Status |
|---|-----------|-------|-------|--------|
| A | Foundation | Scaffold, DB, config, auth, health, metrics | #1 | 🔄 In Progress |
| B | Task Lifecycle | CRUD, state machine, atomic claim, events | #2 | ⏳ Pending |
| C | Pipeline/Template | Templates, instantiation, dependency resolution, context | #3 | ⏳ Pending |
| D | Worker/Events | Registration, heartbeat, WebSocket, webhooks | #4 | ⏳ Pending |
| E | Dashboard + MCP | React SPA, MCP tools, SDKs, E2E, packaging | #5 | ⏳ Pending |

## Technology Stack (Approved)
- **Runtime:** Node.js 22 LTS
- **Framework:** Fastify 5.2
- **ORM:** Drizzle
- **Database:** PostgreSQL 16
- **Dashboard:** React 18 + Vite 6 + TanStack Query 5
- **Package Manager:** pnpm
- **Testing:** Vitest + testcontainers + Playwright
- **Logging:** Pino
- **Metrics:** prom-client

## Key Decisions
- 9 task states: pending, ready, claimed, running, awaiting_approval, output_pending_review, completed, failed, cancelled
- Atomic claim: SELECT FOR UPDATE SKIP LOCKED
- Runtime is OPTIONAL — platform works with external workers only
- Orchestrator is OPTIONAL per template
- REST + MCP for v1.0 (A2A deferred to v1.1)
- JWT auth for dashboard, API keys for agents/workers

## Development Rules
- Test each feature as it's built — no deferred testing
- No mocks in status tracking — ✅ only when fully implemented
- Update traceability matrix after every feature merge
- E2E tests cover all variations (happy + error paths)
