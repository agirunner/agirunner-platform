import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const executionLogSourceEnum = pgEnum('execution_log_source', [
  'runtime',
  'container_manager',
  'platform',
  'task_container',
]);

export const executionLogCategoryEnum = pgEnum('execution_log_category', [
  'llm',
  'tool',
  'agent_loop',
  'task_lifecycle',
  'runtime_lifecycle',
  'container',
  'api',
  'config',
  'auth',
]);

export const executionLogLevelEnum = pgEnum('execution_log_level', [
  'debug',
  'info',
  'warn',
  'error',
]);

export const executionLogStatusEnum = pgEnum('execution_log_status', [
  'started',
  'completed',
  'failed',
  'skipped',
]);

export const executionLogs = pgTable(
  'execution_logs',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: uuid('tenant_id').notNull(),
    traceId: uuid('trace_id').notNull(),
    spanId: uuid('span_id').notNull(),
    parentSpanId: uuid('parent_span_id'),
    source: executionLogSourceEnum('source').notNull(),
    category: executionLogCategoryEnum('category').notNull(),
    level: executionLogLevelEnum('level').notNull().default('info'),
    operation: text('operation').notNull(),
    status: executionLogStatusEnum('status').notNull(),
    durationMs: integer('duration_ms'),
    payload: jsonb('payload').notNull().default({}),
    error: jsonb('error'),
    projectId: uuid('project_id'),
    workflowId: uuid('workflow_id'),
    taskId: uuid('task_id'),
    workItemId: uuid('work_item_id'),
    stageName: text('stage_name'),
    activationId: uuid('activation_id'),
    isOrchestratorTask: boolean('is_orchestrator_task').notNull().default(false),
    actorType: text('actor_type'),
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    resourceName: text('resource_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Note: INCLUDE columns and WHERE clauses are defined in the raw SQL migration.
    // These index definitions provide schema awareness; the migration is the source
    // of truth for covering indexes and partial indexes.
    index('idx_exlogs_tenant_time').on(table.tenantId, table.createdAt),
    index('idx_exlogs_workflow').on(table.workflowId, table.createdAt),
    index('idx_exlogs_task').on(table.taskId, table.createdAt),
    index('idx_exlogs_work_item').on(table.tenantId, table.workItemId, table.createdAt),
    index('idx_exlogs_activation').on(table.tenantId, table.activationId, table.createdAt),
    index('idx_exlogs_stage_name').on(table.tenantId, table.stageName, table.createdAt),
    index('idx_exlogs_orchestrator_task').on(
      table.tenantId,
      table.isOrchestratorTask,
      table.createdAt,
    ),
    index('idx_exlogs_project').on(table.projectId, table.createdAt),
    index('idx_exlogs_trace').on(table.traceId, table.createdAt),
    index('idx_exlogs_category').on(table.tenantId, table.category, table.createdAt),
    index('idx_exlogs_source').on(table.tenantId, table.source, table.createdAt),
    index('idx_exlogs_category_op').on(
      table.tenantId,
      table.category,
      table.operation,
      table.createdAt,
    ),
    index('idx_exlogs_wf_category').on(table.workflowId, table.category, table.createdAt),
    index('idx_exlogs_task_category').on(table.taskId, table.category, table.createdAt),
    index('idx_exlogs_actor').on(table.tenantId, table.actorId, table.createdAt),
    index('idx_exlogs_resource').on(
      table.tenantId,
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    index('idx_exlogs_span').on(table.parentSpanId, table.createdAt),
    index('idx_exlogs_ops_distinct').on(table.tenantId, table.operation, table.createdAt),
  ],
);
