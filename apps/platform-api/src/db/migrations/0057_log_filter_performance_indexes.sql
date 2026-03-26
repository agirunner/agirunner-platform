CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_exlogs_tenant_actor_kind_time
  ON ONLY public.execution_logs (
    tenant_id,
    (
      CASE
        WHEN actor_type IN ('worker', 'agent')
          AND (
            LOWER(COALESCE(role, '')) = 'orchestrator'
            OR COALESCE(is_orchestrator_task, false) = true
          ) THEN 'orchestrator_agent'
        WHEN actor_type = 'worker' THEN 'specialist_agent'
        WHEN actor_type = 'agent' THEN 'specialist_task_execution'
        WHEN actor_type IN ('operator', 'user', 'api_key', 'admin', 'service') THEN 'operator'
        WHEN actor_type = 'system' THEN 'platform_system'
        ELSE COALESCE(actor_type, 'platform_system')
      END
    ),
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_tasks_execution_environment_search
  ON public.tasks
  USING gin (
    LOWER(
      COALESCE(execution_environment_snapshot->>'name', '') || ' ' ||
      COALESCE(execution_environment_snapshot->>'image', '') || ' ' ||
      COALESCE(execution_environment_snapshot->>'resolved_image', '') || ' ' ||
      COALESCE(execution_environment_snapshot->'verified_metadata'->>'distro', '') || ' ' ||
      COALESCE(execution_environment_snapshot->'verified_metadata'->>'package_manager', '')
    ) gin_trgm_ops
  )
  WHERE execution_environment_snapshot IS NOT NULL;
