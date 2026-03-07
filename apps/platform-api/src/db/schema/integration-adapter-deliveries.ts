import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { events } from './events.js';
import { integrationAdapters } from './integration-adapters.js';
import { tenants } from './tenants.js';

export const integrationAdapterDeliveries = pgTable(
  'integration_adapter_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    adapterId: uuid('adapter_id')
      .notNull()
      .references(() => integrationAdapters.id),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_integration_adapter_deliveries_pending').on(table.tenantId, table.status, table.createdAt),
  ],
);
