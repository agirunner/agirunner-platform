import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    eventTypes: text('event_types').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_webhooks_tenant').on(table.tenantId, table.isActive)],
);
