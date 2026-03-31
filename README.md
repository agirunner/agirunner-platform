# Agirunner Platform

Task coordination broker for AI agents. TypeScript/Node/Fastify/PostgreSQL.

## Related Repos

- [agirunner](https://github.com/agirunner/agirunner) — Specs, requirements, design docs
- [agirunner-runtime](https://github.com/agirunner/agirunner-runtime) — Agentic Runtime (Go/Docker)

## V2 Operator References

The active operator and integration model is V2-only:

- playbooks launch workflows
- work items move through board columns and stages
- activations wake the orchestrator
- approvals happen through stage gates and task review flows
- artifacts are previewed through platform permalinks
- memory and history are explicit workspace/workflow/work-item surfaces

Primary operator routes:

- `/mission-control` — live board
- `/work/workflows` — workflow list and workflow detail entry
- `/work/approvals` — approval queue
- `/logs` — execution inspector

Reference docs:

- `../agirunner-docs/designv2/orchestrated-workflow-architecture.md`
- `../agirunner-docs/design/v2-migration-guide.md`
- `../agirunner-docs/design/v2-release-notes.md`

## Testing Documentation (Canonical in Repo)

- `docs/testing/test-plan-v1.0.md`
- `tests/reports/test-cases.v1.json` (**single source of truth** for platform test-case definitions)
- `tests/reports/results.v1.json` (generated consolidated status matrix)
- `tests/reports/batch-results.v1.json` (generated canonical batch-run report, schema-identical to `tests/reports/results.v1.json`)
- `docs/testing/scenario-requirements-map.md`

## Quick Start

```bash
pnpm install
cp .env.example .env

docker compose up -d
pnpm db:migrate
pnpm dev
```

### Compose default topology

`docker compose up -d` now starts:

- `postgres`
- `platform-api`
- `socket-proxy`
- `architect-runtime`, `developer-runtime`, `reviewer-runtime`, `qa-runtime`, `project-manager-runtime`
- `architect-worker`, `developer-worker`, `reviewer-worker`, `qa-worker`, `project-manager-worker`
- `dashboard`

Runtimes and workers are not host-port exposed in the default topology.
`socket-proxy` + the role-specific runtimes communicate over a dedicated bridge network segment (`runtime_internal`), and each worker joins both `platform_net` and `runtime_internal` to bridge API-to-runtime traffic for its role.
For v1.1–v1.2 scope, `runtime_internal` is not marked `internal: true`, so runtime-side containers can still reach external git/LLM endpoints while keeping socket access constrained to `socket-proxy`.

Security defaults in compose/runtime profile:
- default stack uses the real Go runtime from `../agirunner-runtime`
- `*_FILE` secret bindings mounted from `./.secrets` to `/run/secrets`
- `RUNTIME_API_KEY_FILE` required (runtime startup fails when missing/too short)
- task containers default to `${AGIRUNNER_TASK_IMAGE:-alpine/git:2.47.2}` so repository clone/push tooling is present before workspace setup runs

### Prebuilt Runtime Images

To use a fetched runtime image instead of building from `../agirunner-runtime`, set:

```env
AGIRUNNER_RUNTIME_IMAGE=registry.example.com/agirunner/agirunner-runtime@sha256:...
```

The image is expected to support file-backed secret loading. Compose mounts `./.secrets` into every runtime and worker as `/run/secrets` and passes env vars such as:

- `RUNTIME_API_KEY_FILE=/run/secrets/runtime_api_key`
- `DEFAULT_ADMIN_API_KEY_FILE=/run/secrets/default_admin_api_key`
- `JWT_SECRET_FILE=/run/secrets/jwt_secret`
- `WEBHOOK_ENCRYPTION_KEY_FILE=/run/secrets/webhook_encryption_key`
- `OPENAI_API_KEY_FILE=/run/secrets/openai_api_key`

That means a pulled image does not need secrets baked in. It only needs the updated runtime binary that reads `*_FILE` env vars and the mounted `/run/secrets` directory.

### Runtime image strategy

- Local default: `AGIRUNNER_RUNTIME_IMAGE=agirunner-runtime:local` built from `../agirunner-runtime`.
- Staging/release: set `AGIRUNNER_RUNTIME_IMAGE` to a digest-pinned runtime image.

See `docs/testing/v1.05-s3-compose-runtime-image-strategy.md` for stage-specific details and evidence conventions.

## Development

```bash
pnpm test       # Deterministic batch package/unit tests + harness lane guard tests
pnpm test:ci    # CI gate: pnpm test + deterministic core control-plane lane
pnpm lint       # ESLint + Prettier check
pnpm build      # TypeScript compilation
```

## Platform Validation Lanes

```bash
pnpm test:v2-contract                            # Deterministic contract lane
bash tests/live/run.sh --scenario sdlc-assessment-approve
```

See `tests/live/README.md` for the supported live workflow test path.

- Deterministic contract verification remains under package scripts.
- Live workflow verification now runs only from `tests/live/`.
- Live tests must bootstrap state through platform APIs, not DB mutation.
- Live test artifacts default to `tests/live/results/` and are intentionally untracked via the local results `.gitignore`.
