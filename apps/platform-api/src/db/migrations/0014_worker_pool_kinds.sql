BEGIN;

ALTER TABLE worker_desired_state
    ADD COLUMN pool_kind text;

UPDATE worker_desired_state
   SET pool_kind = CASE
       WHEN lower(role) = 'orchestrator' OR lower(worker_name) LIKE '%orchestrator%'
           THEN 'orchestrator'
       ELSE 'specialist'
   END
 WHERE pool_kind IS NULL;

ALTER TABLE worker_desired_state
    ALTER COLUMN pool_kind SET NOT NULL;

ALTER TABLE worker_desired_state
    ALTER COLUMN pool_kind SET DEFAULT 'specialist';

ALTER TABLE worker_desired_state
    ADD CONSTRAINT chk_worker_desired_state_pool_kind
    CHECK (pool_kind IN ('orchestrator', 'specialist'));

CREATE INDEX idx_worker_desired_state_tenant_pool
    ON worker_desired_state (tenant_id, pool_kind);

COMMIT;
