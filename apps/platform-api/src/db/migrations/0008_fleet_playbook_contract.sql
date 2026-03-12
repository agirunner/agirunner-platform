BEGIN;

TRUNCATE TABLE runtime_heartbeats, fleet_events;

ALTER TABLE runtime_heartbeats
  DROP CONSTRAINT IF EXISTS runtime_heartbeats_template_id_fkey;

ALTER TABLE runtime_heartbeats
  DROP CONSTRAINT IF EXISTS runtime_heartbeats_playbook_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'runtime_heartbeats'
       AND column_name = 'template_id'
  ) THEN
    EXECUTE 'ALTER TABLE runtime_heartbeats RENAME COLUMN template_id TO playbook_id';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_runtime_heartbeats_template;
DROP INDEX IF EXISTS idx_runtime_heartbeats_playbook;

CREATE INDEX idx_runtime_heartbeats_playbook
  ON public.runtime_heartbeats USING btree (playbook_id);

ALTER TABLE runtime_heartbeats
  ADD CONSTRAINT runtime_heartbeats_playbook_id_fkey
  FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_events'
       AND column_name = 'template_id'
  ) THEN
    EXECUTE 'ALTER TABLE fleet_events RENAME COLUMN template_id TO playbook_id';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_fleet_events_template;
DROP INDEX IF EXISTS idx_fleet_events_playbook;

CREATE INDEX idx_fleet_events_playbook
  ON public.fleet_events USING btree (playbook_id, created_at DESC);

COMMIT;
