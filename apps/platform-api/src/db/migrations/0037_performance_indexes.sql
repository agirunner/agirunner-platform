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
