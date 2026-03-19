import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { webhookWorkItemTriggers } from './webhook-work-item-triggers.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const webhookWorkItemTriggerInvocations = pgTable(
  'webhook_work_item_trigger_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => webhookWorkItemTriggers.id),
    eventType: text('event_type'),
    dedupeKey: text('dedupe_key'),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_work_item_trigger_invocations_tenant_trigger').on(
      table.tenantId,
      table.triggerId,
      table.createdAt,
    ),
    index('idx_webhook_work_item_trigger_invocations_work_item')
      .on(table.workItemId)
      .where(sql`${table.workItemId} IS NOT NULL`),
  ],
);
