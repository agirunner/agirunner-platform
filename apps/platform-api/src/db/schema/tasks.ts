import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { taskPriorityEnum, taskStateEnum, taskTypeEnum } from './enums.js';
import { pipelines } from './pipelines.js';
import { projects } from './projects.js';
import { tenants } from './tenants.js';
import { workers } from './workers.js';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    pipelineId: uuid('pipeline_id').references(() => pipelines.id),
    projectId: uuid('project_id').references(() => projects.id),
    title: text('title').notNull(),
    type: taskTypeEnum('type').notNull().default('custom'),
    role: text('role'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    state: taskStateEnum('state').notNull().default('pending'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    assignedAgentId: uuid('assigned_agent_id').references((): AnyPgColumn => agents.id),
    assignedWorkerId: uuid('assigned_worker_id').references(() => workers.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    dependsOn: uuid('depends_on').array().notNull().default([]),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    input: jsonb('input').notNull().default({}),
    context: jsonb('context').notNull().default({}),
    output: jsonb('output'),
    error: jsonb('error'),
    capabilitiesRequired: text('capabilities_required').array().notNull().default([]),
    roleConfig: jsonb('role_config'),
    environment: jsonb('environment'),
    resourceBindings: jsonb('resource_bindings').notNull().default([]),
    timeoutMinutes: integer('timeout_minutes').notNull().default(30),
    tokenBudget: integer('token_budget'),
    costCapUsd: numeric('cost_cap_usd', { precision: 10, scale: 4 }),
    autoRetry: boolean('auto_retry').notNull().default(false),
    maxRetries: integer('max_retries').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    reworkCount: integer('rework_count').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metrics: jsonb('metrics'),
    gitInfo: jsonb('git_info'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tasks_tenant').on(table.tenantId),
    index('idx_tasks_pipeline').on(table.pipelineId),
    index('idx_tasks_project').on(table.projectId),
    index('idx_tasks_claimable')
      .on(table.tenantId, table.priority, table.createdAt)
      .where(sql`${table.state} = 'ready'`),
    index('idx_tasks_state').on(table.tenantId, table.state),
    index('idx_tasks_agent')
      .on(table.assignedAgentId)
      .where(sql`${table.assignedAgentId} IS NOT NULL`),
    index('idx_tasks_depends_on').using('gin', table.dependsOn),
    index('idx_tasks_running_timeout')
      .on(table.startedAt)
      .where(sql`${table.state} = 'running'`),
  ],
);
