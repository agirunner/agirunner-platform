ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS attempt_group_id uuid,
  ADD COLUMN IF NOT EXISTS redrive_reason text,
  ADD COLUMN IF NOT EXISTS redrive_input_packet_id uuid,
  ADD COLUMN IF NOT EXISTS inherited_input_packet_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_workflows_attempt_group
  ON workflows (tenant_id, attempt_group_id, attempt_number);

ALTER TABLE workflow_input_packets
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS source_intervention_id uuid,
  ADD COLUMN IF NOT EXISTS source_attempt_id uuid REFERENCES workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_kind text NOT NULL DEFAULT 'operator';
