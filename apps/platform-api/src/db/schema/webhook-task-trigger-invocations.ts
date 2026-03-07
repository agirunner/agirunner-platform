import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { webhookTaskTriggers } from './webhook-task-triggers.js';

export const webhookTaskTriggerInvocations = pgTable(
  'webhook_task_trigger_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => webhookTaskTriggers.id),
    eventType: text('event_type'),
    dedupeKey: text('dedupe_key'),
    taskId: uuid('task_id').references(() => tasks.id),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_task_trigger_invocations_tenant_trigger').on(
      table.tenantId,
      table.triggerId,
      table.createdAt,
    ),
  ],
);
