import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { scheduledWorkItemTriggers } from './scheduled-work-item-triggers.js';
import { tenants } from './tenants.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const scheduledWorkItemTriggerInvocations = pgTable(
  'scheduled_work_item_trigger_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => scheduledWorkItemTriggers.id),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_scheduled_work_item_trigger_invocations_tenant_trigger').on(
      table.tenantId,
      table.triggerId,
      table.createdAt,
    ),
    index('idx_scheduled_work_item_trigger_invocations_work_item')
      .on(table.workItemId)
      .where(sql`${table.workItemId} IS NOT NULL`),
  ],
);
