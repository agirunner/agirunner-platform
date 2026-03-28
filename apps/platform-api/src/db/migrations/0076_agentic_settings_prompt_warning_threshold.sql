ALTER TABLE agentic_settings
  ADD COLUMN IF NOT EXISTS assembled_prompt_warning_threshold_chars integer NOT NULL DEFAULT 32000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'agentic_settings_assembled_prompt_warning_threshold_chars_check'
  ) THEN
    ALTER TABLE agentic_settings
      ADD CONSTRAINT agentic_settings_assembled_prompt_warning_threshold_chars_check CHECK (
        assembled_prompt_warning_threshold_chars > 0
      );
  END IF;
END $$;
