CREATE INDEX IF NOT EXISTS idx_exlogs_search_document
  ON ONLY public.execution_logs
  USING gin (
    to_tsvector('simple', CONCAT_WS(' ',
      operation,
      task_id::text,
      work_item_id::text,
      activation_id::text,
      workflow_id::text,
      workspace_id::text,
      stage_name,
      trace_id,
      span_id,
      workflow_name,
      workspace_name,
      task_title,
      role,
      actor_type,
      actor_id,
      actor_name,
      resource_type,
      resource_name,
      error->>'message',
      payload->>'system_prompt',
      payload->>'prompt_summary',
      payload->>'response_summary',
      payload->>'response_text',
      payload->>'tool_name',
      payload::text
    ))
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
