import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowStages } from './workflow-stages.js';

export const workflowStageGates = pgTable(
  'workflow_stage_gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => workflowStages.id),
    stageName: text('stage_name').notNull(),
    requestSummary: text('request_summary').notNull(),
    recommendation: text('recommendation'),
    concerns: jsonb('concerns').notNull().default([]),
    keyArtifacts: jsonb('key_artifacts').notNull().default([]),
    status: text('status').notNull().default('awaiting_approval'),
    closureEffect: text('closure_effect').notNull().default('blocking'),
    requestedByType: text('requested_by_type').notNull(),
    requestedById: text('requested_by_id'),
    requestedByTaskId: uuid('requested_by_task_id').references(() => tasks.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestedByWorkItemId: uuid('requested_by_work_item_id'),
    requestedReason: text('requested_reason'),
    subjectRevision: integer('subject_revision'),
    resolutionStatus: text('resolution_status'),
    decisionFeedback: text('decision_feedback'),
    decidedByType: text('decided_by_type'),
    decidedById: text('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    resolvedByTaskId: uuid('resolved_by_task_id').references(() => tasks.id),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededByRevision: integer('superseded_by_revision'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_workflow_stage_gates_active')
      .on(table.tenantId, table.workflowId, table.stageId)
      .where(sql`status = 'awaiting_approval'`),
    index('idx_workflow_stage_gates_queue').on(table.tenantId, table.status, table.requestedAt),
    index('idx_workflow_stage_gates_workflow_stage').on(table.tenantId, table.workflowId, table.stageId, table.requestedAt),
  ],
);
