ALTER TABLE public.execution_logs
  ADD COLUMN work_item_id uuid,
  ADD COLUMN stage_name text,
  ADD COLUMN activation_id uuid,
  ADD COLUMN is_orchestrator_task boolean NOT NULL DEFAULT false;

CREATE INDEX idx_exlogs_work_item
  ON ONLY public.execution_logs USING btree (tenant_id, work_item_id, created_at DESC)
  INCLUDE (source, category, level, operation, status, duration_ms, workflow_id, task_id)
  WHERE (work_item_id IS NOT NULL);

CREATE INDEX idx_exlogs_activation
  ON ONLY public.execution_logs USING btree (tenant_id, activation_id, created_at DESC)
  INCLUDE (source, category, level, operation, status, duration_ms, workflow_id, task_id)
  WHERE (activation_id IS NOT NULL);

CREATE INDEX idx_exlogs_stage_name
  ON ONLY public.execution_logs USING btree (tenant_id, stage_name, created_at DESC)
  INCLUDE (source, category, level, operation, status, workflow_id, task_id, work_item_id)
  WHERE (stage_name IS NOT NULL);

CREATE INDEX idx_exlogs_orchestrator_task
  ON ONLY public.execution_logs USING btree (tenant_id, is_orchestrator_task, created_at DESC)
  INCLUDE (source, category, level, operation, status, workflow_id, task_id, work_item_id);

DROP TRIGGER IF EXISTS trg_execution_logs_notify ON public.execution_logs;
DROP FUNCTION IF EXISTS public.notify_execution_log();

CREATE FUNCTION public.notify_execution_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    'work_item_id', NEW.work_item_id,
    'stage_name', NEW.stage_name,
    'activation_id', NEW.activation_id,
    'is_orchestrator_task', NEW.is_orchestrator_task,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_execution_logs_notify
  AFTER INSERT ON public.execution_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_execution_log();
