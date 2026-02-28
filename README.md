# AgentBaton Platform

Task coordination broker for AI agents. TypeScript/Node/Fastify/PostgreSQL.

## Related Repos
- [agentbaton](https://github.com/agirunner/agentbaton) — Specs, requirements, design docs
- [agentbaton-runtime](https://github.com/agirunner/agentbaton-runtime) — Agentic Runtime (Go/Docker)

## Quick Start
```bash
cd platform
pnpm install
docker-compose up -d postgres  # Start PostgreSQL
pnpm db:migrate
pnpm dev
```

## Development
```bash
pnpm test     # Run all tests
pnpm lint     # ESLint + Prettier check
pnpm build    # TypeScript compilation
```
