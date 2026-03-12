CREATE TABLE playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  outcome text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'standard',
  version integer NOT NULL DEFAULT 1,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_playbooks_tenant_slug_version UNIQUE (tenant_id, slug, version),
  CONSTRAINT playbooks_lifecycle_check
    CHECK (lifecycle IN ('standard', 'continuous'))
);

CREATE INDEX idx_playbooks_tenant_active
  ON playbooks (tenant_id, is_active, created_at DESC);

ALTER TABLE workflows
  ADD COLUMN playbook_id uuid REFERENCES playbooks(id),
  ADD COLUMN playbook_version integer,
  ADD COLUMN lifecycle text,
  ADD COLUMN current_stage text,
  ADD COLUMN orchestration_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflows
  ADD CONSTRAINT workflows_lifecycle_check
    CHECK (lifecycle IS NULL OR lifecycle IN ('standard', 'continuous'));

CREATE INDEX idx_workflows_playbook
  ON workflows (playbook_id);

CREATE TABLE workflow_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  parent_work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE CASCADE,
  stage_name text NOT NULL,
  title text NOT NULL,
  goal text,
  acceptance_criteria text,
  column_id text NOT NULL,
  owner_role text,
  priority task_priority NOT NULL DEFAULT 'normal',
  request_id text,
  notes text,
  created_by text NOT NULL DEFAULT 'manual',
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_work_items_created_by_check
    CHECK (created_by IN ('orchestrator', 'api', 'webhook', 'manual'))
);

CREATE INDEX idx_workflow_work_items_tenant_workflow
  ON workflow_work_items (tenant_id, workflow_id, created_at DESC);
CREATE INDEX idx_workflow_work_items_stage
  ON workflow_work_items (tenant_id, workflow_id, stage_name);
CREATE INDEX idx_workflow_work_items_column
  ON workflow_work_items (tenant_id, workflow_id, column_id);
CREATE UNIQUE INDEX idx_workflow_work_items_request_id
  ON workflow_work_items (tenant_id, workflow_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE workflow_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  request_id text,
  reason text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'queued',
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  summary text,
  error jsonb,
  CONSTRAINT workflow_activations_state_check
    CHECK (state IN ('queued', 'processing', 'completed', 'failed'))
);

CREATE UNIQUE INDEX idx_workflow_activations_request_id
  ON workflow_activations (tenant_id, workflow_id, request_id)
  WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_workflow_activations_active
  ON workflow_activations (workflow_id)
  WHERE state = 'processing';
CREATE INDEX idx_workflow_activations_queue
  ON workflow_activations (tenant_id, workflow_id, state, queued_at);

ALTER TABLE tasks
  ADD COLUMN work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  ADD COLUMN stage_name text,
  ADD COLUMN activation_id uuid REFERENCES workflow_activations(id) ON DELETE SET NULL,
  ADD COLUMN request_id text,
  ADD COLUMN is_orchestrator_task boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_tasks_request_id
  ON tasks (tenant_id, request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX idx_tasks_work_item
  ON tasks (tenant_id, work_item_id);
CREATE INDEX idx_tasks_activation
  ON tasks (tenant_id, activation_id);
CREATE INDEX idx_tasks_stage
  ON tasks (tenant_id, workflow_id, stage_name);
