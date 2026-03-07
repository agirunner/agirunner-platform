import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { integrationAdapters } from './integration-adapters.js';
import { tenants } from './tenants.js';

export const integrationResourceLinks = pgTable(
  'integration_resource_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    adapterId: uuid('adapter_id')
      .notNull()
      .references(() => integrationAdapters.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_integration_resource_links_unique').on(
      table.tenantId,
      table.adapterId,
      table.entityType,
      table.entityId,
    ),
    index('idx_integration_resource_links_external').on(table.tenantId, table.adapterId, table.externalId),
  ],
);
