ALTER TABLE task_handoffs
  ADD COLUMN IF NOT EXISTS resolution text;

UPDATE task_handoffs
   SET resolution = CASE
     WHEN COALESCE(role_data->>'review_outcome', '') IN ('approved', 'request_changes', 'rejected')
       THEN role_data->>'review_outcome'
     ELSE resolution
   END
 WHERE resolution IS NULL;

UPDATE task_handoffs
   SET completion = 'full'
 WHERE completion = 'partial';

ALTER TABLE task_handoffs
  DROP CONSTRAINT IF EXISTS task_handoffs_completion_check;

ALTER TABLE task_handoffs
  ADD CONSTRAINT task_handoffs_completion_check
  CHECK (completion IN ('full', 'blocked'));

ALTER TABLE task_handoffs
  DROP CONSTRAINT IF EXISTS task_handoffs_resolution_check;

ALTER TABLE task_handoffs
  ADD CONSTRAINT task_handoffs_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('approved', 'request_changes', 'rejected'));
