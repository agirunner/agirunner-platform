-- Remove the partial filter from idx_exlogs_search so full-text search
-- works across all log levels, not just warn/error.
DROP INDEX IF EXISTS idx_exlogs_search;
CREATE INDEX idx_exlogs_search
  ON execution_logs USING gin (
    to_tsvector('english', operation || ' ' || COALESCE(payload::text, ''))
  );
