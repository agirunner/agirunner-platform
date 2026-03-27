import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const workflowInterventions = pgTable(
  'workflow_interventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    origin: text('origin').notNull().default('operator'),
    status: text('status').notNull().default('applied'),
    summary: text('summary').notNull(),
    note: text('note'),
    structuredAction: jsonb('structured_action').notNull().default({}),
    metadata: jsonb('metadata').notNull().default({}),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_interventions_tenant_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_interventions_work_item').on(table.tenantId, table.workItemId),
    index('idx_workflow_interventions_task').on(table.tenantId, table.taskId),
  ],
);
