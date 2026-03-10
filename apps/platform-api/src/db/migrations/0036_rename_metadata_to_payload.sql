TRUNCATE execution_logs;
ALTER TABLE execution_logs RENAME COLUMN metadata TO payload;

-- Recreate functional indexes that referenced the old column name

DROP INDEX IF EXISTS idx_exlogs_search;
CREATE INDEX idx_exlogs_search
  ON execution_logs USING gin (
    to_tsvector('english', operation || ' ' || COALESCE(payload::text, ''))
  )
  WHERE level IN ('warn', 'error');

DROP INDEX IF EXISTS idx_exlogs_stats;
CREATE INDEX idx_exlogs_stats
  ON execution_logs (tenant_id, category, created_at DESC)
  INCLUDE (duration_ms, payload)
  WHERE status IN ('completed', 'failed');

DROP INDEX IF EXISTS idx_exlogs_llm_model;
CREATE INDEX idx_exlogs_llm_model
  ON execution_logs ((payload->>'model'), created_at DESC)
  WHERE category = 'llm';

DROP INDEX IF EXISTS idx_exlogs_llm_provider;
CREATE INDEX idx_exlogs_llm_provider
  ON execution_logs ((payload->>'provider'), created_at DESC)
  WHERE category = 'llm';

DROP INDEX IF EXISTS idx_exlogs_tool_name;
CREATE INDEX idx_exlogs_tool_name
  ON execution_logs ((payload->>'tool_name'), created_at DESC)
  WHERE category = 'tool';

DROP INDEX IF EXISTS idx_exlogs_config_type;
CREATE INDEX idx_exlogs_config_type
  ON execution_logs ((payload->>'config_type'), created_at DESC)
  WHERE category = 'config';
