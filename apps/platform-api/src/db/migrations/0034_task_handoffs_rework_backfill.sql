DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'task_handoffs'
       AND column_name = 'task_rework_count'
  ) THEN
    EXECUTE 'ALTER TABLE task_handoffs ADD COLUMN task_rework_count integer';
  END IF;

  EXECUTE 'UPDATE task_handoffs SET task_rework_count = 0 WHERE task_rework_count IS NULL';
  EXECUTE 'ALTER TABLE task_handoffs ALTER COLUMN task_rework_count SET DEFAULT 0';
  EXECUTE 'ALTER TABLE task_handoffs ALTER COLUMN task_rework_count SET NOT NULL';
  EXECUTE 'DROP INDEX IF EXISTS idx_task_handoffs_task_id';
  EXECUTE 'DROP INDEX IF EXISTS idx_task_handoffs_task_attempt';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_task_handoffs_task_attempt ON task_handoffs (task_id, task_rework_count)';
END
$$;
