WITH tenant_specialist_capacity AS (
  SELECT
    t.id AS tenant_id,
    CASE
      WHEN specialist.config_value ~ '^[0-9]+$' THEN specialist.config_value
      WHEN runtime_cap.config_value ~ '^[0-9]+$' AND execution_cap.config_value ~ '^[0-9]+$'
        THEN LEAST(runtime_cap.config_value::int, execution_cap.config_value::int)::text
      WHEN runtime_cap.config_value ~ '^[0-9]+$' THEN runtime_cap.config_value
      WHEN execution_cap.config_value ~ '^[0-9]+$' THEN execution_cap.config_value
      ELSE '20'
    END AS config_value
  FROM tenants t
  LEFT JOIN runtime_defaults AS specialist
    ON specialist.tenant_id = t.id
   AND specialist.config_key = 'global_max_specialists'
  LEFT JOIN runtime_defaults AS runtime_cap
    ON runtime_cap.tenant_id = t.id
   AND runtime_cap.config_key = 'global_max_runtimes'
  LEFT JOIN runtime_defaults AS execution_cap
    ON execution_cap.tenant_id = t.id
   AND execution_cap.config_key = 'global_max_execution_containers'
)
INSERT INTO runtime_defaults (
  tenant_id,
  config_key,
  config_value,
  config_type,
  description
)
SELECT
  tenant_id,
  'global_max_specialists',
  config_value,
  'number',
  'Hard ceiling on concurrently active specialists. Each active specialist consumes one runtime and one execution container'
FROM tenant_specialist_capacity
ON CONFLICT (tenant_id, config_key) DO UPDATE
SET
  config_value = EXCLUDED.config_value,
  config_type = EXCLUDED.config_type,
  description = EXCLUDED.description,
  updated_at = NOW();

DELETE FROM runtime_defaults
WHERE config_key IN (
  'global_max_runtimes',
  'global_max_execution_containers',
  'queue.max_concurrency'
);
