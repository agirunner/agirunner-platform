-- 0031_execution_logs.sql
-- Unified logging table with monthly partitioning, comprehensive indexes,
-- PG NOTIFY trigger for real-time streaming, and partition management functions.
-- Design: /home/mark/codex/agirunner-docs/design/unified-logging-and-log-viewer.md §4.1

CREATE TYPE execution_log_source AS ENUM (
  'runtime',
  'container_manager',
  'platform',
  'task_container'
);

CREATE TYPE execution_log_category AS ENUM (
  'llm',
  'tool',
  'agent_loop',
  'task_lifecycle',
  'container',
  'api',
  'config',
  'auth'
);

CREATE TYPE execution_log_level AS ENUM (
  'debug',
  'info',
  'warn',
  'error'
);

CREATE TYPE execution_log_status AS ENUM (
  'started',
  'completed',
  'failed',
  'skipped'
);

CREATE TABLE execution_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id       uuid         NOT NULL,
  trace_id        uuid         NOT NULL,
  span_id         uuid         NOT NULL,
  parent_span_id  uuid,
  source          execution_log_source   NOT NULL,
  category        execution_log_category NOT NULL,
  level           execution_log_level    NOT NULL DEFAULT 'info',
  operation       text         NOT NULL,
  status          execution_log_status   NOT NULL,
  duration_ms     integer,
  metadata        jsonb        NOT NULL DEFAULT '{}',
  error           jsonb,
  -- Denormalized entity references for fast filtering without JOINs
  project_id      uuid,
  workflow_id     uuid,
  task_id         uuid,
  -- Denormalized actor info for display without JOINs
  actor_type      text,
  actor_id        text,
  actor_name      text,
  -- Denormalized resource info for display without JOINs
  resource_type   text,
  resource_id     uuid,
  resource_name   text,
  created_at      timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (current + next month; cron job creates future partitions)
CREATE TABLE execution_logs_2026_03 PARTITION OF execution_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE execution_logs_2026_04 PARTITION OF execution_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- ============================================================================
-- INDEX STRATEGY
--
-- Design principles:
--   1. Every UI filter combination hits an index — no sequential scans.
--   2. Compound indexes ordered: equality columns first, then range (created_at).
--   3. Partial indexes (WHERE ... IS NOT NULL) keep index size small.
--   4. Partitioning by created_at means time-range queries only scan relevant
--      partitions — each partition has its own copy of every index.
--   5. INCLUDE columns added where we need index-only scans (covering indexes)
--      to avoid heap lookups for common queries.
-- ============================================================================

-- 1. PRIMARY QUERY: tenant-scoped, time-ordered (default /logs page)
CREATE INDEX idx_exlogs_tenant_time
  ON execution_logs (tenant_id, created_at DESC)
  INCLUDE (source, category, level, operation, status, duration_ms, workflow_id, task_id, actor_name, resource_name);

-- 2. WORKFLOW DRILL-DOWN: most common query — user picks a workflow
CREATE INDEX idx_exlogs_workflow
  ON execution_logs (workflow_id, created_at ASC)
  INCLUDE (source, category, level, operation, status, duration_ms, task_id, actor_name)
  WHERE workflow_id IS NOT NULL;

-- 3. TASK DRILL-DOWN: user picks a specific task
CREATE INDEX idx_exlogs_task
  ON execution_logs (task_id, created_at ASC)
  INCLUDE (source, category, level, operation, status, duration_ms, actor_name)
  WHERE task_id IS NOT NULL;

-- 4. PROJECT DRILL-DOWN: user picks a project (all workflows in it)
CREATE INDEX idx_exlogs_project
  ON execution_logs (project_id, created_at DESC)
  INCLUDE (source, category, level, operation, status, workflow_id, task_id)
  WHERE project_id IS NOT NULL;

-- 5. TRACE CORRELATION: follow a single workflow run or API request end-to-end
CREATE INDEX idx_exlogs_trace
  ON execution_logs (trace_id, created_at ASC)
  INCLUDE (span_id, parent_span_id, source, category, operation, status, duration_ms);

-- 6. CATEGORY FILTER: user filters by category (llm, tool, agent_loop, api, config, auth)
CREATE INDEX idx_exlogs_category
  ON execution_logs (tenant_id, category, created_at DESC)
  INCLUDE (source, level, operation, status, duration_ms, workflow_id, task_id);

-- 7. SOURCE FILTER: user filters by source (runtime, platform, container_manager)
CREATE INDEX idx_exlogs_source
  ON execution_logs (tenant_id, source, created_at DESC)
  INCLUDE (category, level, operation, status, duration_ms, workflow_id, task_id);

-- 8. CATEGORY + OPERATION: user drills into specific operation type
CREATE INDEX idx_exlogs_category_op
  ON execution_logs (tenant_id, category, operation, created_at DESC)
  INCLUDE (source, level, status, duration_ms, workflow_id, task_id);

-- 9. WORKFLOW + CATEGORY: most common compound filter
CREATE INDEX idx_exlogs_wf_category
  ON execution_logs (workflow_id, category, created_at ASC)
  INCLUDE (source, level, operation, status, duration_ms, task_id)
  WHERE workflow_id IS NOT NULL;

-- 10. TASK + CATEGORY: task detail page with category filter
CREATE INDEX idx_exlogs_task_category
  ON execution_logs (task_id, category, created_at ASC)
  INCLUDE (source, level, operation, status, duration_ms)
  WHERE task_id IS NOT NULL;

-- 11. ERROR SCANNING: fast "show me all errors" across tenant
CREATE INDEX idx_exlogs_errors
  ON execution_logs (tenant_id, created_at DESC)
  INCLUDE (source, category, operation, workflow_id, task_id, actor_name, error)
  WHERE level = 'error' OR status = 'failed';

-- 12. ACTOR FILTER: "what did this user/worker/agent do?"
CREATE INDEX idx_exlogs_actor
  ON execution_logs (tenant_id, actor_id, created_at DESC)
  INCLUDE (source, category, operation, status, workflow_id, task_id, actor_name)
  WHERE actor_id IS NOT NULL;

-- 13. RESOURCE FILTER: "what happened to this entity?"
CREATE INDEX idx_exlogs_resource
  ON execution_logs (tenant_id, resource_type, resource_id, created_at DESC)
  INCLUDE (category, operation, status, actor_name)
  WHERE resource_id IS NOT NULL;

-- 14. STATUS FILTER: "show me all failed operations"
CREATE INDEX idx_exlogs_status
  ON execution_logs (tenant_id, status, created_at DESC)
  INCLUDE (source, category, operation, level, workflow_id, task_id)
  WHERE status IN ('failed', 'started');

-- 15. FULL-TEXT SEARCH: search across operation names + metadata content
CREATE INDEX idx_exlogs_search
  ON execution_logs USING gin (
    to_tsvector('english', operation || ' ' || COALESCE(metadata::text, ''))
  );

-- 16. STATS AGGREGATION: GROUP BY queries for summary cards
CREATE INDEX idx_exlogs_stats
  ON execution_logs (workflow_id, category, status)
  INCLUDE (duration_ms, metadata)
  WHERE workflow_id IS NOT NULL;

-- 17. OPERATIONS DROPDOWN: distinct operation names with counts
CREATE INDEX idx_exlogs_ops_distinct
  ON execution_logs (tenant_id, operation, created_at DESC);

-- 18. ACTORS DROPDOWN: distinct actors with counts
CREATE INDEX idx_exlogs_actors_distinct
  ON execution_logs (tenant_id, actor_type, actor_id, actor_name, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- 19. SPAN DRILL-DOWN: parent-child relationship traversal
CREATE INDEX idx_exlogs_span
  ON execution_logs (parent_span_id, created_at ASC)
  INCLUDE (span_id, source, category, operation, status, duration_ms)
  WHERE parent_span_id IS NOT NULL;

-- 20. JSONB PATH INDEXES: fast extraction of common metadata fields
CREATE INDEX idx_exlogs_llm_model
  ON execution_logs ((metadata->>'model'), created_at DESC)
  WHERE category = 'llm';

CREATE INDEX idx_exlogs_llm_provider
  ON execution_logs ((metadata->>'provider'), created_at DESC)
  WHERE category = 'llm';

CREATE INDEX idx_exlogs_tool_name
  ON execution_logs ((metadata->>'tool_name'), created_at DESC)
  WHERE category = 'tool';

CREATE INDEX idx_exlogs_config_type
  ON execution_logs ((metadata->>'config_type'), created_at DESC)
  WHERE category = 'config';

-- Real-time notification trigger
CREATE OR REPLACE FUNCTION notify_execution_log() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('agirunner_execution_logs', json_build_object(
    'id', NEW.id,
    'tenant_id', NEW.tenant_id,
    'trace_id', NEW.trace_id,
    'source', NEW.source,
    'category', NEW.category,
    'level', NEW.level,
    'operation', NEW.operation,
    'project_id', NEW.project_id,
    'workflow_id', NEW.workflow_id,
    'task_id', NEW.task_id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_execution_logs_notify
  AFTER INSERT ON execution_logs
  FOR EACH ROW EXECUTE FUNCTION notify_execution_log();

-- Partition maintenance function (called monthly via cron)
CREATE OR REPLACE FUNCTION create_execution_logs_partition(
  partition_date date
) RETURNS void AS $$
DECLARE
  partition_name text;
  start_date date;
  end_date date;
BEGIN
  start_date := date_trunc('month', partition_date);
  end_date := start_date + interval '1 month';
  partition_name := 'execution_logs_' || to_char(start_date, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF execution_logs
     FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;

-- Retention: drop partitions older than configured retention
CREATE OR REPLACE FUNCTION drop_old_execution_log_partitions(
  retention_days integer DEFAULT 30
) RETURNS void AS $$
DECLARE
  partition record;
  cutoff date;
BEGIN
  cutoff := current_date - (retention_days || ' days')::interval;
  FOR partition IN
    SELECT inhrelid::regclass::text AS name
    FROM pg_inherits
    WHERE inhparent = 'execution_logs'::regclass
  LOOP
    IF partition.name < 'execution_logs_' || to_char(cutoff, 'YYYY_MM') THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition.name);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
