DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'workflow_operator_briefs'
       AND column_name = 'request_id'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE workflow_operator_briefs
      ALTER COLUMN request_id TYPE text USING request_id::text;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'workflow_operator_briefs'
       AND column_name = 'execution_context_id'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE workflow_operator_briefs
      ALTER COLUMN execution_context_id TYPE text USING execution_context_id::text;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'workflow_operator_updates'
       AND column_name = 'request_id'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE workflow_operator_updates
      ALTER COLUMN request_id TYPE text USING request_id::text;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'workflow_operator_updates'
       AND column_name = 'execution_context_id'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE workflow_operator_updates
      ALTER COLUMN execution_context_id TYPE text USING execution_context_id::text;
  END IF;
END $$;
