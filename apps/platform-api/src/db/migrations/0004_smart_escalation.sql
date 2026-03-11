-- Add escalation config to role definitions
ALTER TABLE role_definitions
  ADD COLUMN IF NOT EXISTS escalation_target TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_escalation_depth INTEGER NOT NULL DEFAULT 5;

-- Add awaiting_escalation to task state enum
ALTER TYPE task_state ADD VALUE IF NOT EXISTS 'awaiting_escalation' AFTER 'output_pending_review';
