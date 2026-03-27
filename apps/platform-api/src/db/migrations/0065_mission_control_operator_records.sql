CREATE TABLE IF NOT EXISTS workflow_input_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  packet_kind text NOT NULL,
  source text NOT NULL DEFAULT 'operator',
  summary text,
  structured_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_input_packets_tenant_workflow
  ON workflow_input_packets (tenant_id, workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_input_packets_work_item
  ON workflow_input_packets (tenant_id, work_item_id);

CREATE TABLE IF NOT EXISTS workflow_input_packet_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  packet_id uuid NOT NULL REFERENCES workflow_input_packets(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  description text,
  storage_backend text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_input_packet_files_packet
  ON workflow_input_packet_files (tenant_id, packet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_input_packet_files_workflow
  ON workflow_input_packet_files (tenant_id, workflow_id);

CREATE TABLE IF NOT EXISTS workflow_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  kind text NOT NULL,
  origin text NOT NULL DEFAULT 'operator',
  status text NOT NULL DEFAULT 'applied',
  summary text NOT NULL,
  note text,
  structured_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_interventions_tenant_workflow
  ON workflow_interventions (tenant_id, workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_interventions_work_item
  ON workflow_interventions (tenant_id, work_item_id);

CREATE INDEX IF NOT EXISTS idx_workflow_interventions_task
  ON workflow_interventions (tenant_id, task_id);

CREATE TABLE IF NOT EXISTS workflow_intervention_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  intervention_id uuid NOT NULL REFERENCES workflow_interventions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  description text,
  storage_backend text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_intervention_files_intervention
  ON workflow_intervention_files (tenant_id, intervention_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_intervention_files_workflow
  ON workflow_intervention_files (tenant_id, workflow_id);

CREATE TABLE IF NOT EXISTS workflow_steering_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title text,
  status text NOT NULL DEFAULT 'active',
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_steering_sessions_tenant_workflow
  ON workflow_steering_sessions (tenant_id, workflow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_steering_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  steering_session_id uuid NOT NULL REFERENCES workflow_steering_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  structured_proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  intervention_id uuid REFERENCES workflow_interventions(id) ON DELETE SET NULL,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_steering_messages_session
  ON workflow_steering_messages (tenant_id, steering_session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_steering_messages_workflow
  ON workflow_steering_messages (tenant_id, workflow_id);
