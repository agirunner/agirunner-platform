-- Performance indexes: unindexed FKs, missing filter indexes, composite query optimizations
-- All indexes are non-unique, performance-only — no semantic changes.

-- P0: Critical (hot query paths)
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_worker
  ON tasks (assigned_worker_id)
  WHERE assigned_worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_container_images_repo_tag
  ON container_images (repository, tag);

CREATE INDEX IF NOT EXISTS idx_container_images_digest
  ON container_images (digest)
  WHERE digest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_task_messages_orchestrator_task
  ON orchestrator_task_messages (tenant_id, orchestrator_task_id);

-- P1: High (unindexed FKs on growing tables)
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
  ON webhook_deliveries (webhook_id);

CREATE INDEX IF NOT EXISTS idx_integration_adapter_deliveries_adapter
  ON integration_adapter_deliveries (adapter_id);

CREATE INDEX IF NOT EXISTS idx_integration_adapter_deliveries_event
  ON integration_adapter_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_integration_actions_adapter
  ON integration_actions (tenant_id, adapter_id);

CREATE INDEX IF NOT EXISTS idx_worker_signals_task
  ON worker_signals (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_events_workflow
  ON fleet_events (workflow_id, created_at)
  WHERE workflow_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_events_task
  ON fleet_events (task_id, created_at)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_work_item_trigger_invocations_work_item
  ON webhook_work_item_trigger_invocations (work_item_id)
  WHERE work_item_id IS NOT NULL;

-- P2: Medium (composite query optimizations, lower-traffic FK indexes)
CREATE INDEX IF NOT EXISTS idx_scheduled_work_item_trigger_invocations_work_item
  ON scheduled_work_item_trigger_invocations (work_item_id)
  WHERE work_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_documents_artifact
  ON workflow_documents (artifact_id)
  WHERE artifact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_task_messages_worker
  ON orchestrator_task_messages (tenant_id, worker_id)
  WHERE worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_work_items_parent
  ON workflow_work_items (tenant_id, parent_work_item_id)
  WHERE parent_work_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_state
  ON tasks (tenant_id, workflow_id, state);

CREATE INDEX IF NOT EXISTS idx_exlogs_level
  ON execution_logs (tenant_id, level, created_at);

-- P3: Low (small tables, rare queries)
CREATE INDEX IF NOT EXISTS idx_exlogs_status
  ON execution_logs (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_role_model_assignments_role
  ON role_model_assignments (tenant_id, role_name);

CREATE INDEX IF NOT EXISTS idx_llm_models_model_id
  ON llm_models (tenant_id, model_id);

-- Additional unindexed FKs found in second audit pass
CREATE INDEX IF NOT EXISTS idx_role_model_assignments_model
  ON role_model_assignments (primary_model_id)
  WHERE primary_model_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_work_item_triggers_workflow
  ON scheduled_work_item_triggers (workflow_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_work_item_triggers_workspace
  ON scheduled_work_item_triggers (workspace_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON webhook_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_work_item_triggers_workflow
  ON webhook_work_item_triggers (workflow_id);

CREATE INDEX IF NOT EXISTS idx_webhook_work_item_triggers_workspace
  ON webhook_work_item_triggers (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_workspace
  ON workflow_artifacts (tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_workflow_documents_workspace
  ON workflow_documents (tenant_id, workspace_id);

-- JSONB expression indexes for query patterns that filter on extracted JSON fields
CREATE INDEX IF NOT EXISTS idx_tasks_metadata_escalation_task_id
  ON tasks (tenant_id, (metadata ->> 'escalation_task_id'))
  WHERE metadata ->> 'escalation_task_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_metadata_parent_id
  ON tasks (tenant_id, (metadata ->> 'parent_id'))
  WHERE metadata ->> 'parent_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_retention_mode
  ON workflow_artifacts (tenant_id, workflow_id, (retention_policy ->> 'mode'))
  WHERE retention_policy ->> 'mode' IS NOT NULL;

-- execution_logs.role — already exists in 0001_init as idx_execution_logs_role,
-- this adds the created_at column for time-range filtered role queries
CREATE INDEX IF NOT EXISTS idx_exlogs_role
  ON execution_logs (tenant_id, role, created_at)
  WHERE role IS NOT NULL;

-- Compound indexes for background job queries (cross-tenant scans)

-- task-timeout-service: scans active tasks (claimed/in_progress) by started_at/claimed_at
-- The existing idx_tasks_running_timeout only covers state='in_progress',
-- but timeout service also checks 'claimed' state
CREATE INDEX IF NOT EXISTS idx_tasks_active_timeout
  ON tasks (state, started_at, claimed_at)
  WHERE state IN ('claimed', 'in_progress');

-- task-timeout-service: finds tasks with workflow_cancel_force_at metadata key
CREATE INDEX IF NOT EXISTS idx_tasks_cancel_pending
  ON tasks (state, ((metadata ->> 'workflow_cancel_force_at')))
  WHERE state IN ('claimed', 'in_progress')
    AND metadata ->> 'workflow_cancel_force_at' IS NOT NULL;

-- worker-heartbeat-service: scans workers by status + last_heartbeat_at (cross-tenant)
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat_timeout
  ON workers (status, last_heartbeat_at)
  WHERE last_heartbeat_at IS NOT NULL;

-- governance-service: archives/deletes completed tasks by completed_at date
CREATE INDEX IF NOT EXISTS idx_tasks_completed_archive
  ON tasks (tenant_id, completed_at)
  WHERE completed_at IS NOT NULL AND archived_at IS NULL;

-- Compound indexes for hot-path query patterns

-- workers.routes.ts: agent lookup by worker during task claiming
-- Existing idx_agents_worker is (worker_id) only — no tenant or sort support
CREATE INDEX IF NOT EXISTS idx_agents_tenant_worker
  ON agents (tenant_id, worker_id, created_at);

-- acp-session-service.ts: findReusableSession sorts by updated_at DESC
-- but idx_acp_sessions_tenant_agent uses created_at DESC
CREATE INDEX IF NOT EXISTS idx_acp_sessions_reusable
  ON acp_sessions (tenant_id, agent_id, updated_at DESC)
  WHERE status IN ('initializing', 'active', 'idle');
