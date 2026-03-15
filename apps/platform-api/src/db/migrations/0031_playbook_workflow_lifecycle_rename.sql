UPDATE playbooks
   SET lifecycle = CASE lifecycle
     WHEN 'standard' THEN 'planned'
     WHEN 'continuous' THEN 'ongoing'
     ELSE lifecycle
   END,
       definition = CASE
         WHEN definition->>'lifecycle' IN ('standard', 'continuous')
           THEN jsonb_set(
             definition,
             '{lifecycle}',
             to_jsonb(
               CASE definition->>'lifecycle'
                 WHEN 'standard' THEN 'planned'
                 WHEN 'continuous' THEN 'ongoing'
                 ELSE definition->>'lifecycle'
               END
             ),
             true
           )
         ELSE definition
       END,
       updated_at = now()
 WHERE lifecycle IN ('standard', 'continuous')
    OR definition->>'lifecycle' IN ('standard', 'continuous');

UPDATE workflows
   SET lifecycle = CASE lifecycle
     WHEN 'standard' THEN 'planned'
     WHEN 'continuous' THEN 'ongoing'
     ELSE lifecycle
   END,
       updated_at = now()
 WHERE lifecycle IN ('standard', 'continuous');

ALTER TABLE playbooks
  DROP CONSTRAINT IF EXISTS playbooks_lifecycle_check;

ALTER TABLE playbooks
  ADD CONSTRAINT playbooks_lifecycle_check
  CHECK (lifecycle IN ('planned', 'ongoing'));

ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS workflows_lifecycle_check;

ALTER TABLE workflows
  ADD CONSTRAINT workflows_lifecycle_check
  CHECK (lifecycle IS NULL OR lifecycle IN ('planned', 'ongoing'));

ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS chk_workflows_continuous_current_stage_null;

ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS chk_workflows_ongoing_current_stage_null;

ALTER TABLE workflows
  ADD CONSTRAINT chk_workflows_ongoing_current_stage_null
  CHECK (lifecycle IS DISTINCT FROM 'ongoing' OR current_stage IS NULL);
