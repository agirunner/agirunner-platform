# Milestone C — Pipeline & Template Engine Plan

## Original implementation

- [x] Read MEMORY.md and required context/spec docs (CONTEXT + implementation/design/requirements/scenarios)
- [x] Implement Template CRUD API (`POST/GET list/GET by id/PATCH/DELETE`) with admin-only create/delete and soft delete behavior
- [x] Add template validation module: schema shape checks, dependency-reference checks, DAG cycle detection with cycle path output
- [x] Implement Pipeline API (`POST/GET list/GET by id/POST cancel`) with filtering + pagination
- [x] Implement pipeline instantiation from template (task creation, dependency wiring, variable merge/substitution, initial states)
- [x] Add pipeline state derivation + event emission on state changes
- [x] Extend task completion side-effects for dependency unblocking + pipeline context accumulation + pipeline state recompute
- [x] Enhance `GET /api/v1/tasks/:id/context` with template metadata and pipeline variables
- [x] Add unit tests (DAG cycle detection, variable substitution, pipeline state derivation)
- [x] Add integration tests (template→pipeline instantiation, dependency cascade, pipeline cancellation cascade)
- [x] Add E2E tests (full pipeline lifecycle, template CRUD, 401/403/404/409/422 matrix for milestone C endpoints)
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json + memory log
- [x] Commit, push `feature/milestone-c`, open PR against `main`

## PR #10 review fixes

- [x] Read review findings and inspect affected code paths/tests
- [x] Fix derivePipelineState so any failed task immediately fails the pipeline
- [x] Fix cancel cascade to cancel all non-completed tasks (including failed)
- [x] Change template PATCH to create new immutable version row
- [x] Ensure pipeline creation resolves latest template version by default
- [x] Add/adjust unit+integration+e2e tests for all three findings
- [x] Run `pnpm test && pnpm lint`
- [x] Update STATUS.json + memory log
- [x] Commit and push to `feature/milestone-c`
