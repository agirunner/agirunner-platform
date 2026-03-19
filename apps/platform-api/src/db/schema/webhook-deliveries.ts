import { index, integer, pgTable, text, timestamp, uuid, bigint } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { tenants } from './tenants.js';
import { webhooks } from './webhooks.js';

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id),
    eventType: text('event_type').notNull(),
    attempts: integer('attempts').notNull().default(0),
    status: text('status').notNull().default('pending'),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_deliveries_pending').on(table.tenantId, table.status, table.createdAt),
    index('idx_webhook_deliveries_webhook').on(table.webhookId),
    index('idx_webhook_deliveries_event').on(table.eventId),
  ],
);
