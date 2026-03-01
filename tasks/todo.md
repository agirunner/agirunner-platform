# FR Implementation Plan — feature/missing-frs

## 9 Missing FRs

- [ ] FR-150 + FR-152 + FR-761: TenantScopedRepository + data-access layer filtering
- [ ] FR-712: No template nesting constraint in validateTemplateSchema
- [ ] FR-741: Standalone worker entry point
- [ ] FR-752: Built-in agent replaceability via capability matching
- [ ] FR-754: Zero-config seed — default tenant + API key on first run
- [ ] FR-756: Built-in agents use same capability system (no exclusive privileges)
- [ ] FR-820: Worker network transparency + allowed origins config

## Files to Create/Edit
- `src/db/tenant-scoped-repository.ts` (NEW)
- `src/orchestration/pipeline-engine.ts` (EDIT — add nesting validation)
- `src/worker-process.ts` (NEW — standalone worker entry)
- `src/bootstrap/built-in-worker.ts` (NEW)
- `src/orchestration/capability-matcher.ts` (EDIT — add replaceability check)
- `src/db/seed.ts` (EDIT — seed default API key)
- `src/config/schema.ts` (EDIT — WORKER_ALLOWED_ORIGINS)
- `tests/unit/fr-missing-implementations.test.ts` (NEW — all 9 FR tests)
