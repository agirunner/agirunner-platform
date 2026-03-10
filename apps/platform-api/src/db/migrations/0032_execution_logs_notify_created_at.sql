-- 0032_execution_logs_notify_created_at.sql
-- Add created_at to the PG NOTIFY payload so LogStreamService can query
-- the partitioned table efficiently using the partition key.

CREATE OR REPLACE FUNCTION notify_execution_log() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('agirunner_execution_logs', json_build_object(
    'id', NEW.id,
    'tenant_id', NEW.tenant_id,
    'trace_id', NEW.trace_id,
    'source', NEW.source,
    'category', NEW.category,
    'level', NEW.level,
    'operation', NEW.operation,
    'project_id', NEW.project_id,
    'workflow_id', NEW.workflow_id,
    'task_id', NEW.task_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
