ALTER TABLE scheduled_work_item_triggers
  ADD COLUMN schedule_type text NOT NULL DEFAULT 'interval',
  ADD COLUMN daily_time text,
  ADD COLUMN timezone text;

ALTER TABLE scheduled_work_item_triggers
  ALTER COLUMN cadence_minutes DROP NOT NULL;

UPDATE scheduled_work_item_triggers
   SET source = 'project.schedule'
 WHERE source IS DISTINCT FROM 'project.schedule';

ALTER TABLE scheduled_work_item_triggers
  ADD CONSTRAINT chk_scheduled_work_item_trigger_schedule_mode
  CHECK (
    (
      schedule_type = 'interval'
      AND cadence_minutes IS NOT NULL
      AND cadence_minutes > 0
      AND daily_time IS NULL
      AND timezone IS NULL
    )
    OR
    (
      schedule_type = 'daily_time'
      AND cadence_minutes IS NULL
      AND daily_time IS NOT NULL
      AND timezone IS NOT NULL
    )
  );
