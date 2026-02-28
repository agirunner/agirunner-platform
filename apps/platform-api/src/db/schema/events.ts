import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { eventEntityTypeEnum } from './enums.js';
import { tenants } from './tenants.js';

export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: text('type').notNull(),
    entityType: eventEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_events_tenant_time').on(table.tenantId, table.createdAt),
    index('idx_events_entity').on(table.entityType, table.entityId, table.createdAt),
    index('idx_events_type').on(table.tenantId, table.type, table.createdAt),
  ],
);
