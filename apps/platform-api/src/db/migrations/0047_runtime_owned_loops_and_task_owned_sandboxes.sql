DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type
     WHERE typname = 'execution_backend'
  ) THEN
    CREATE TYPE execution_backend AS ENUM ('runtime_only', 'runtime_plus_task');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type
     WHERE typname = 'tool_owner'
  ) THEN
    CREATE TYPE tool_owner AS ENUM ('runtime', 'task');
  END IF;
END $$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS execution_backend execution_backend NOT NULL DEFAULT 'runtime_plus_task';

UPDATE tasks
   SET execution_backend = CASE
     WHEN is_orchestrator_task THEN 'runtime_only'::execution_backend
     ELSE 'runtime_plus_task'::execution_backend
   END
 WHERE execution_backend IS DISTINCT FROM CASE
   WHEN is_orchestrator_task THEN 'runtime_only'::execution_backend
   ELSE 'runtime_plus_task'::execution_backend
 END;

CREATE INDEX IF NOT EXISTS idx_tasks_execution_backend
  ON tasks (tenant_id, execution_backend);

ALTER TABLE execution_logs
  ADD COLUMN IF NOT EXISTS execution_backend execution_backend,
  ADD COLUMN IF NOT EXISTS tool_owner tool_owner;

CREATE INDEX IF NOT EXISTS idx_exlogs_execution_backend
  ON execution_logs (tenant_id, execution_backend, created_at);

CREATE INDEX IF NOT EXISTS idx_exlogs_tool_owner
  ON execution_logs (tenant_id, tool_owner, created_at);

ALTER TABLE live_container_inventory
  ADD COLUMN IF NOT EXISTS execution_backend execution_backend;

CREATE INDEX IF NOT EXISTS idx_live_container_inventory_execution_backend
  ON live_container_inventory (tenant_id, execution_backend, last_seen_at);
