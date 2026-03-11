-- Migration: Switch execution_logs from monthly to daily partitions
-- This enables precise 30-day retention instead of coarse monthly drops.

-- Replace create function: daily partitions (execution_logs_YYYY_MM_DD)
CREATE OR REPLACE FUNCTION public.create_execution_logs_partition(partition_date date) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  partition_name text;
  start_date date;
  end_date date;
BEGIN
  start_date := partition_date;
  end_date := start_date + interval '1 day';
  partition_name := 'execution_logs_' || to_char(start_date, 'YYYY_MM_DD');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF execution_logs
     FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$;

-- Replace drop function: compare daily partition names
CREATE OR REPLACE FUNCTION public.drop_old_execution_log_partitions(retention_days integer DEFAULT 30) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  partition record;
  cutoff date;
  cutoff_name text;
BEGIN
  cutoff := current_date - (retention_days || ' days')::interval;
  cutoff_name := 'execution_logs_' || to_char(cutoff, 'YYYY_MM_DD');
  FOR partition IN
    SELECT inhrelid::regclass::text AS name
    FROM pg_inherits
    WHERE inhparent = 'execution_logs'::regclass
  LOOP
    IF partition.name < cutoff_name THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition.name);
    END IF;
  END LOOP;
END;
$$;

-- Migrate existing monthly partitions to daily:
-- 1. Detach monthly partitions
-- 2. Create daily partitions for the date range
-- 3. Move data from monthly into daily
-- 4. Drop the old monthly partitions

DO $$
DECLARE
  monthly record;
  day_cursor date;
  month_start date;
  month_end date;
  partition_name text;
BEGIN
  -- Process each existing monthly partition
  FOR monthly IN
    SELECT inhrelid::regclass::text AS name
    FROM pg_inherits
    WHERE inhparent = 'execution_logs'::regclass
    ORDER BY 1
  LOOP
    -- Parse month from partition name (execution_logs_YYYY_MM)
    month_start := to_date(substring(monthly.name from 'execution_logs_(\d{4}_\d{2})'), 'YYYY_MM');
    month_end := month_start + interval '1 month';

    -- Detach the monthly partition
    EXECUTE format('ALTER TABLE execution_logs DETACH PARTITION %I', monthly.name);

    -- Create daily partitions and move data
    day_cursor := month_start;
    WHILE day_cursor < month_end LOOP
      partition_name := 'execution_logs_' || to_char(day_cursor, 'YYYY_MM_DD');

      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF execution_logs
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, day_cursor, day_cursor + interval '1 day'
      );

      EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE created_at >= %L AND created_at < %L',
        partition_name, monthly.name, day_cursor, day_cursor + interval '1 day'
      );

      day_cursor := day_cursor + interval '1 day';
    END LOOP;

    -- Drop the old monthly partition
    EXECUTE format('DROP TABLE %I', monthly.name);
  END LOOP;
END;
$$;
