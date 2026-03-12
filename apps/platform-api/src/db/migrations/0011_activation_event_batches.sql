ALTER TABLE workflow_activations
  ADD COLUMN IF NOT EXISTS activation_id uuid,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_workflow_activations_activation
  ON workflow_activations (tenant_id, workflow_id, activation_id);

CREATE INDEX IF NOT EXISTS idx_workflow_activations_consumed
  ON workflow_activations (tenant_id, workflow_id, consumed_at, queued_at);

UPDATE workflow_activations
   SET activation_id = id
 WHERE activation_id IS NULL
   AND state = 'processing';

UPDATE workflow_activations
   SET activation_id = COALESCE(activation_id, id),
       consumed_at = COALESCE(consumed_at, completed_at, now())
 WHERE state IN ('completed', 'failed')
   AND consumed_at IS NULL;
