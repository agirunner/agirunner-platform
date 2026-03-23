import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const taskHandoffs = pgTable(
  'task_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    taskReworkCount: integer('task_rework_count').notNull().default(0),
    requestId: text('request_id'),
    role: text('role').notNull(),
    teamName: text('team_name'),
    stageName: text('stage_name'),
    sequence: integer('sequence').notNull().default(0),
    summary: text('summary').notNull(),
    completion: text('completion').notNull().default('full'),
    completionState: text('completion_state').notNull().default('full'),
    resolution: text('resolution'),
    decisionState: text('decision_state'),
    changes: jsonb('changes').notNull().default([]),
    decisions: jsonb('decisions').notNull().default([]),
    remainingItems: jsonb('remaining_items').notNull().default([]),
    blockers: jsonb('blockers').notNull().default([]),
    focusAreas: text('focus_areas').array().notNull().default(sql`'{}'::text[]`),
    knownRisks: text('known_risks').array().notNull().default(sql`'{}'::text[]`),
    successorContext: text('successor_context'),
    roleData: jsonb('role_data').notNull().default({}),
    subjectRef: jsonb('subject_ref'),
    subjectRevision: integer('subject_revision'),
    outcomeActionApplied: text('outcome_action_applied'),
    branchId: uuid('branch_id'),
    artifactIds: uuid('artifact_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_task_handoffs_work_item').on(table.tenantId, table.workItemId, table.sequence),
    index('idx_task_handoffs_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    uniqueIndex('idx_task_handoffs_task_attempt').on(table.taskId, table.taskReworkCount),
    uniqueIndex('idx_task_handoffs_request_id')
      .on(table.tenantId, table.workflowId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
  ],
);
