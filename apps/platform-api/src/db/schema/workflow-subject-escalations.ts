import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflowWorkItems } from './workflow-work-items.js';
import { workflows } from './workflows.js';

export const workflowSubjectEscalations = pgTable(
  'workflow_subject_escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id),
    subjectRef: jsonb('subject_ref').notNull().default({}),
    subjectRevision: integer('subject_revision'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    createdByTaskId: uuid('created_by_task_id').references(() => tasks.id),
    resolutionAction: text('resolution_action'),
    resolutionFeedback: text('resolution_feedback'),
    resolvedByType: text('resolved_by_type'),
    resolvedById: text('resolved_by_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_subject_escalations_workflow')
      .on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_subject_escalations_status')
      .on(table.tenantId, table.workflowId, table.status, table.createdAt),
    index('idx_workflow_subject_escalations_work_item')
      .on(table.tenantId, table.workflowId, table.workItemId)
      .where(sql`${table.workItemId} IS NOT NULL`),
  ],
);
