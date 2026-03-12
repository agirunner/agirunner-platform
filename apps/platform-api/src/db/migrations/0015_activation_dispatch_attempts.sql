ALTER TABLE workflow_activations
  ADD COLUMN IF NOT EXISTS dispatch_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_token uuid;

UPDATE workflow_activations
   SET dispatch_attempt = 1
 WHERE dispatch_attempt = 0
   AND (activation_id IS NOT NULL OR started_at IS NOT NULL OR consumed_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_workflow_activations_dispatch_attempt
  ON workflow_activations (tenant_id, workflow_id, dispatch_attempt);
