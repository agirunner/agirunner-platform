TRUNCATE TABLE worker_actual_state;

DROP INDEX IF EXISTS idx_worker_actual_state_desired;

CREATE UNIQUE INDEX idx_worker_actual_state_desired
  ON worker_actual_state (desired_state_id);
