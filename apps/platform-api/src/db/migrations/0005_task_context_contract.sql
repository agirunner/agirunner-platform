-- Task execution context contract: persist explicit task context on tasks.
-- Enables deterministic failure-mode flags (e.g. AP-7 failure_mode) to flow
-- through dispatch/execution paths without relying on prompt interpretation.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}';
