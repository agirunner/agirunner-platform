-- Migration 0019: Rename pipeline → workflow
-- Breaking API change — executed before v2 work begins.

-- Rename tables
ALTER TABLE pipelines RENAME TO workflows;
ALTER TABLE pipeline_artifacts RENAME TO workflow_artifacts;
ALTER TABLE pipeline_documents RENAME TO workflow_documents;

-- Rename columns across tables
ALTER TABLE tasks RENAME COLUMN pipeline_id TO workflow_id;
ALTER TABLE integration_adapters RENAME COLUMN pipeline_id TO workflow_id;
ALTER TABLE orchestrator_grants RENAME COLUMN pipeline_id TO workflow_id;
ALTER TABLE webhook_task_triggers RENAME COLUMN pipeline_id TO workflow_id;
ALTER TABLE webhook_task_trigger_invocations RENAME COLUMN pipeline_id TO workflow_id;

-- Rename enum type
ALTER TYPE pipeline_state_enum RENAME TO workflow_state_enum;

-- Rename indexes (if explicitly named with 'pipeline')
ALTER INDEX IF EXISTS idx_pipelines_tenant RENAME TO idx_workflows_tenant;
ALTER INDEX IF EXISTS idx_pipelines_project RENAME TO idx_workflows_project;
ALTER INDEX IF EXISTS idx_pipelines_state RENAME TO idx_workflows_state;
ALTER INDEX IF EXISTS idx_pipelines_template RENAME TO idx_workflows_template;
