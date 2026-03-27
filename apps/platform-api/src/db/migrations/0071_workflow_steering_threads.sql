ALTER TABLE workflow_steering_sessions
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

ALTER TABLE workflow_steering_sessions
  ALTER COLUMN status SET DEFAULT 'open';

UPDATE workflow_steering_sessions
   SET status = 'open'
 WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_workflow_steering_sessions_work_item
  ON workflow_steering_sessions (tenant_id, workflow_id, work_item_id)
  WHERE work_item_id IS NOT NULL;

ALTER TABLE workflow_steering_messages
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS message_kind text,
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS linked_intervention_id uuid REFERENCES workflow_interventions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_input_packet_id uuid REFERENCES workflow_input_packets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_operator_update_id uuid REFERENCES workflow_operator_updates(id) ON DELETE SET NULL;

UPDATE workflow_steering_messages
   SET source_kind = CASE
     WHEN role = 'operator' THEN 'operator'
     WHEN role = 'system' THEN 'system'
     ELSE 'platform'
   END
 WHERE source_kind IS NULL;

UPDATE workflow_steering_messages
   SET message_kind = CASE
     WHEN role = 'operator' THEN 'operator_request'
     WHEN role = 'system' THEN 'system_notice'
     ELSE 'steering_response'
   END
 WHERE message_kind IS NULL;

UPDATE workflow_steering_messages
   SET headline = CASE
     WHEN length(trim(content)) <= 255 THEN trim(content)
     ELSE left(trim(content), 252) || '...'
   END
 WHERE headline IS NULL;

UPDATE workflow_steering_messages
   SET body = CASE
     WHEN length(trim(content)) > 255 THEN trim(content)
     ELSE NULL
   END
 WHERE body IS NULL;

UPDATE workflow_steering_messages
   SET linked_intervention_id = intervention_id
 WHERE linked_intervention_id IS NULL
   AND intervention_id IS NOT NULL;

ALTER TABLE workflow_steering_messages
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN message_kind SET NOT NULL,
  ALTER COLUMN headline SET NOT NULL;

ALTER TABLE workflow_steering_messages
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS structured_proposal,
  DROP COLUMN IF EXISTS intervention_id;

CREATE INDEX IF NOT EXISTS idx_workflow_steering_messages_work_item
  ON workflow_steering_messages (tenant_id, workflow_id, work_item_id, created_at ASC)
  WHERE work_item_id IS NOT NULL;
