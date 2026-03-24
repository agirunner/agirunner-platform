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
    'workspace_id', NEW.workspace_id,
    'workflow_id', NEW.workflow_id,
    'task_id', NEW.task_id,
    'work_item_id', NEW.work_item_id,
    'stage_name', NEW.stage_name,
    'activation_id', NEW.activation_id,
    'is_orchestrator_task', NEW.is_orchestrator_task,
    'execution_backend', NEW.execution_backend,
    'tool_owner', NEW.tool_owner,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_execution_logs_notify
  AFTER INSERT ON public.execution_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_execution_log();
