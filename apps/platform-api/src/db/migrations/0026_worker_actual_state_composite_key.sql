-- Fix: allow multiple containers per desired state (replicas > 1).
-- The old unique index on desired_state_id alone caused upsert to
-- overwrite container data when multiple replicas shared the same
-- desired state, leaving only the last-heartbeated container tracked.
DROP INDEX IF EXISTS idx_worker_actual_state_desired;
CREATE UNIQUE INDEX idx_worker_actual_state_desired_container
  ON worker_actual_state (desired_state_id, container_id);
