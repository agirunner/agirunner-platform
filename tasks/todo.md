# TODO — Docker compose containerization fixes

- [x] Review existing Dockerfiles and compose wiring for platform-api/dashboard/postgres
- [x] Rework `apps/platform-api/Dockerfile` to use `pnpm deploy` standalone output with resolved monorepo deps
- [x] Ensure platform-api runtime image includes `configs/` and starts from `dist/src/index.js`
- [x] Verify `apps/dashboard/Dockerfile` build/runtime flow and adjust only if needed for static output
- [x] Add/update `.env.example` to document required compose environment variables (`JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY`)
- [x] Run end-to-end docker validation (`docker compose up -d --build`, `docker compose ps`, `curl /health`, `docker compose down -v`)
- [x] Update `STATUS.json`, commit, push `fix/dockerfiles`, and open PR
