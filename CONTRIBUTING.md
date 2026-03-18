# Contributing to agirunner-platform

This repo contains the Platform API, Dashboard, and Container Manager.

For the overall project contribution guide, see
[agirunner/CONTRIBUTING.md](https://github.com/agirunner/agirunner/blob/main/CONTRIBUTING.md).

## Prerequisites

- Node.js 22+
- Docker and Docker Compose (for PostgreSQL)
- pnpm (vendored at `.bin/pnpm` — do NOT install globally)

## Development Setup

```bash
# Clone
git clone https://github.com/YOUR-USERNAME/agirunner-platform
cd agirunner-platform

# Install dependencies
PATH=".bin:$PATH" pnpm install

# Start PostgreSQL and supporting services
docker compose up -d postgres socket-proxy

# Start Platform API (port 8080)
PATH=".bin:$PATH" pnpm --filter platform-api dev

# Start Dashboard (port 5173 in dev, 3000 in production)
PATH=".bin:$PATH" pnpm --filter dashboard dev
```

## Project Structure

```
apps/
  platform-api/          — Fastify API server
    src/
      api/routes/        — HTTP route handlers
      services/          — Business logic
      db/schema/         — Drizzle ORM schema
      db/migrations/     — SQL migrations (run automatically on startup)
      orchestration/     — Playbook model, state machines
      catalogs/          — Built-in roles, playbooks, prompts
  dashboard/             — React SPA (Vite + Tailwind v4 + Radix UI)
    src/
      pages/             — Page components by section
      components/        — Shared UI components
      lib/               — API client, utilities

packages/
  sdk/                   — TypeScript SDK (@agirunner/sdk)
  mcp-server/            — MCP server package
  shared-types/          — Shared type definitions
  python-sdk/            — Python SDK

services/
  container-manager/     — Go service for Docker container lifecycle
```

## Running Tests

```bash
# All tests
PATH=".bin:$PATH" pnpm test

# Platform API tests only
PATH=".bin:$PATH" pnpm --filter platform-api test

# Dashboard tests only
PATH=".bin:$PATH" pnpm --filter dashboard test

# Watch mode
PATH=".bin:$PATH" pnpm --filter platform-api test -- --watch
```

Test runner: **vitest** (not jest).

## Container Manager (Go)

The container manager is a Go service at `services/container-manager/`.

```bash
cd services/container-manager
go build -o container-manager ./cmd/container-manager
go test ./...
```

## Database Migrations

Migrations are SQL files in `apps/platform-api/src/db/migrations/`.
They run automatically on platform API startup. To add a new migration:

1. Create `NNNN_description.sql` (next number in sequence)
2. Write idempotent SQL
3. Restart the platform API — migration runs on startup

## Key Conventions

- **pnpm is vendored** at `.bin/pnpm` — always use `PATH=".bin:$PATH" pnpm`
- **Zod** for all API input validation
- **Drizzle ORM** for database queries (no raw SQL in route handlers)
- **TanStack Query** for all dashboard data fetching
- **Tailwind v4** for styling (no CSS modules, no styled-components)
- **Conventional commits**: `type(scope): description`
