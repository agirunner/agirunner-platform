import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const workflowSteeringSessions = pgTable(
  'workflow_steering_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    title: text('title'),
    status: text('status').notNull().default('open'),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_workflow_steering_sessions_tenant_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_steering_sessions_work_item')
      .on(table.tenantId, table.workflowId, table.workItemId)
      .where(sql`${table.workItemId} IS NOT NULL`),
  ],
);
