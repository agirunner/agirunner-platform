import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflowOperatorBriefs } from './workflow-operator-briefs.js';
import { workflowWorkItems } from './workflow-work-items.js';
import { workflows } from './workflows.js';

export const workflowOperatorUpdates = pgTable(
  'workflow_operator_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    executionContextId: text('execution_context_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceRoleName: text('source_role_name'),
    updateKind: text('update_kind').notNull(),
    headline: text('headline').notNull(),
    summary: text('summary'),
    linkedTargetIds: jsonb('linked_target_ids').notNull().default([]),
    visibilityMode: text('visibility_mode').notNull(),
    promotedBriefId: uuid('promoted_brief_id').references(() => workflowOperatorBriefs.id, { onDelete: 'set null' }),
    sequenceNumber: integer('sequence_number').notNull(),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_operator_updates_workflow_sequence').on(
      table.tenantId,
      table.workflowId,
      table.sequenceNumber,
    ),
    index('idx_workflow_operator_updates_work_item').on(table.tenantId, table.workItemId),
    uniqueIndex('uq_workflow_operator_updates_request').on(table.tenantId, table.workflowId, table.requestId),
    check('workflow_operator_updates_sequence_positive', sql`${table.sequenceNumber} > 0`),
    check(
      'workflow_operator_updates_visibility_mode_check',
      sql`${table.visibilityMode} IN ('standard', 'enhanced')`,
    ),
  ],
);
