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
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { taskPriorityEnum, taskStateEnum } from './enums.js';
import { workflows } from './workflows.js';
import { workspaces } from './workspaces.js';
import { tenants } from './tenants.js';
import { workers } from './workers.js';
import { workflowActivations } from './workflow-activations.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id').references(() => workflows.id),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    title: text('title').notNull(),
    role: text('role'),
    stageName: text('stage_name'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    state: taskStateEnum('state').notNull().default('pending'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    assignedAgentId: uuid('assigned_agent_id').references((): AnyPgColumn => agents.id),
    assignedWorkerId: uuid('assigned_worker_id').references(() => workers.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    dependsOn: uuid('depends_on').array().notNull().default([]),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    requiresOutputReview: boolean('requires_output_review').notNull().default(false),
    input: jsonb('input').notNull().default({}),
    context: jsonb('context').notNull().default({}),
    output: jsonb('output'),
    error: jsonb('error'),
    capabilitiesRequired: text('capabilities_required').array().notNull().default([]),
    roleConfig: jsonb('role_config'),
    environment: jsonb('environment'),
    resourceBindings: jsonb('resource_bindings').notNull().default([]),
    activationId: uuid('activation_id').references(() => workflowActivations.id),
    requestId: text('request_id'),
    isOrchestratorTask: boolean('is_orchestrator_task').notNull().default(false),
    timeoutMinutes: integer('timeout_minutes').notNull().default(30),
    tokenBudget: integer('token_budget'),
    costCapUsd: numeric('cost_cap_usd', { precision: 10, scale: 4 }),
    autoRetry: boolean('auto_retry').notNull().default(false),
    maxRetries: integer('max_retries').notNull().default(0),
    maxIterations: integer('max_iterations'),
    llmMaxRetries: integer('llm_max_retries'),
    retryCount: integer('retry_count').notNull().default(0),
    reworkCount: integer('rework_count').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metrics: jsonb('metrics'),
    gitInfo: jsonb('git_info'),
    legalHold: boolean('legal_hold').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tasks_tenant').on(table.tenantId),
    index('idx_tasks_workflow').on(table.workflowId),
    index('idx_tasks_work_item').on(table.tenantId, table.workItemId),
    index('idx_tasks_workspace').on(table.workspaceId),
    index('idx_tasks_activation').on(table.tenantId, table.activationId),
    index('idx_tasks_stage').on(table.tenantId, table.workflowId, table.stageName),
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
      .where(sql`${table.state} = 'in_progress'`),
    uniqueIndex('idx_tasks_request_id_workflow')
      .on(table.tenantId, table.workflowId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL AND ${table.workflowId} IS NOT NULL`),
    uniqueIndex('idx_tasks_request_id_no_workflow')
      .on(table.tenantId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL AND ${table.workflowId} IS NULL`),
  ],
);
