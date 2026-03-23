ALTER TABLE task_handoffs
  ADD COLUMN IF NOT EXISTS completion_state text,
  ADD COLUMN IF NOT EXISTS decision_state text,
  ADD COLUMN IF NOT EXISTS subject_ref jsonb,
  ADD COLUMN IF NOT EXISTS subject_revision integer,
  ADD COLUMN IF NOT EXISTS outcome_action_applied text,
  ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE task_handoffs
   SET completion_state = COALESCE(completion_state, completion),
       decision_state = COALESCE(decision_state, resolution),
       subject_revision = COALESCE(
         subject_revision,
         NULLIF(COALESCE(role_data->>'subject_revision', ''), '')::integer
       ),
       branch_id = COALESCE(
         branch_id,
         CASE
           WHEN COALESCE(role_data->>'branch_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             THEN (role_data->>'branch_id')::uuid
           ELSE NULL
         END
       );

UPDATE task_handoffs
   SET subject_ref = COALESCE(
     subject_ref,
     CASE
       WHEN branch_id IS NOT NULL THEN jsonb_strip_nulls(
         jsonb_build_object(
           'kind', 'branch',
           'branch_id', branch_id,
           'task_id', NULLIF(COALESCE(role_data->>'subject_task_id', ''), ''),
           'work_item_id', NULLIF(COALESCE(role_data->>'subject_work_item_id', ''), ''),
           'handoff_id', NULLIF(COALESCE(role_data->>'subject_handoff_id', ''), '')
         )
       )
       WHEN COALESCE(role_data->>'subject_task_id', '') <> '' THEN jsonb_strip_nulls(
         jsonb_build_object(
           'kind', 'task',
           'task_id', role_data->>'subject_task_id',
           'work_item_id', NULLIF(COALESCE(role_data->>'subject_work_item_id', ''), ''),
           'handoff_id', NULLIF(COALESCE(role_data->>'subject_handoff_id', ''), '')
         )
       )
       WHEN COALESCE(role_data->>'subject_work_item_id', '') <> '' THEN jsonb_strip_nulls(
         jsonb_build_object(
           'kind', 'work_item',
           'work_item_id', role_data->>'subject_work_item_id',
           'handoff_id', NULLIF(COALESCE(role_data->>'subject_handoff_id', ''), '')
         )
       )
       WHEN COALESCE(role_data->>'subject_handoff_id', '') <> '' THEN jsonb_build_object(
         'kind', 'handoff',
         'handoff_id', role_data->>'subject_handoff_id'
       )
       ELSE NULL
     END
   );

UPDATE task_handoffs
   SET completion_state = 'full'
 WHERE completion_state IS NULL;

ALTER TABLE task_handoffs
  ALTER COLUMN completion_state SET DEFAULT 'full',
  ALTER COLUMN completion_state SET NOT NULL;

ALTER TABLE task_handoffs
  DROP CONSTRAINT IF EXISTS task_handoffs_completion_state_check;

ALTER TABLE task_handoffs
  ADD CONSTRAINT task_handoffs_completion_state_check
  CHECK (completion_state IN ('full', 'blocked'));

ALTER TABLE task_handoffs
  DROP CONSTRAINT IF EXISTS task_handoffs_decision_state_check;

ALTER TABLE task_handoffs
  ADD CONSTRAINT task_handoffs_decision_state_check
  CHECK (decision_state IS NULL OR decision_state IN ('approved', 'request_changes', 'rejected', 'blocked'));
