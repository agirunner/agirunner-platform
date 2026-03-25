CREATE INDEX IF NOT EXISTS idx_exlogs_search_document
  ON ONLY public.execution_logs
  USING gin (
    to_tsvector('simple',
      COALESCE(operation, '') || ' ' ||
      COALESCE(task_id::text, '') || ' ' ||
      COALESCE(work_item_id::text, '') || ' ' ||
      COALESCE(activation_id::text, '') || ' ' ||
      COALESCE(workflow_id::text, '') || ' ' ||
      COALESCE(workspace_id::text, '') || ' ' ||
      COALESCE(stage_name, '') || ' ' ||
      COALESCE(trace_id, '') || ' ' ||
      COALESCE(span_id, '') || ' ' ||
      COALESCE(workflow_name, '') || ' ' ||
      COALESCE(workspace_name, '') || ' ' ||
      COALESCE(task_title, '') || ' ' ||
      COALESCE(role, '') || ' ' ||
      COALESCE(actor_type, '') || ' ' ||
      COALESCE(actor_id, '') || ' ' ||
      COALESCE(actor_name, '') || ' ' ||
      COALESCE(resource_type, '') || ' ' ||
      COALESCE(resource_name, '') || ' ' ||
      COALESCE(error->>'message', '') || ' ' ||
      COALESCE(payload->>'system_prompt', '') || ' ' ||
      COALESCE(payload->>'prompt_summary', '') || ' ' ||
      COALESCE(payload->>'response_summary', '') || ' ' ||
      COALESCE(payload->>'response_text', '') || ' ' ||
      COALESCE(payload->>'tool_name', '') || ' ' ||
      COALESCE(payload::text, '')
    )
  );

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_workspace_time
  ON ONLY public.execution_logs (tenant_id, workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_workflow_time
  ON ONLY public.execution_logs (tenant_id, workflow_id, created_at DESC)
  WHERE workflow_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_task_time
  ON ONLY public.execution_logs (tenant_id, task_id, created_at DESC)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_trace_time
  ON ONLY public.execution_logs (tenant_id, trace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_workflow_operation_time
  ON ONLY public.execution_logs (tenant_id, workflow_id, operation, created_at DESC)
  WHERE workflow_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_workflow_role_time
  ON ONLY public.execution_logs (tenant_id, workflow_id, role, created_at DESC)
  WHERE workflow_id IS NOT NULL
    AND role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_workflow_actor_time
  ON ONLY public.execution_logs (tenant_id, workflow_id, actor_type, role, created_at DESC)
  WHERE workflow_id IS NOT NULL
    AND actor_type IS NOT NULL;
