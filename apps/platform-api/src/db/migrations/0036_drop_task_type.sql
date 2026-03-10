-- Remove the task_type column and enum.
-- Task behavior is now driven entirely by the 'role' column.
ALTER TABLE tasks DROP COLUMN IF EXISTS type;
DROP TYPE IF EXISTS task_type;
