BEGIN;

ALTER TABLE runtime_heartbeats
    ADD COLUMN pool_kind text;

UPDATE runtime_heartbeats rh
   SET pool_kind = CASE
       WHEN t.is_orchestrator_task = true THEN 'orchestrator'
       ELSE 'specialist'
   END
  FROM tasks t
 WHERE rh.task_id IS NOT NULL
   AND t.tenant_id = rh.tenant_id
   AND t.id = rh.task_id
   AND rh.pool_kind IS NULL;

UPDATE runtime_heartbeats
   SET pool_kind = 'specialist'
 WHERE pool_kind IS NULL;

ALTER TABLE runtime_heartbeats
    ALTER COLUMN pool_kind SET NOT NULL;

ALTER TABLE runtime_heartbeats
    ALTER COLUMN pool_kind SET DEFAULT 'specialist';

ALTER TABLE runtime_heartbeats
    ADD CONSTRAINT chk_runtime_heartbeats_pool_kind
    CHECK (pool_kind IN ('orchestrator', 'specialist'));

CREATE INDEX idx_runtime_heartbeats_tenant_pool
    ON runtime_heartbeats (tenant_id, pool_kind);

COMMIT;
