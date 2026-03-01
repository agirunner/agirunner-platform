-- Add 'disconnected' to worker_status enum for grace period support (#14)
DO $$ BEGIN
  ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'disconnected';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
