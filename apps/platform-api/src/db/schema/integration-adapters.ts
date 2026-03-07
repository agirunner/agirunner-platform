import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pipelines } from './pipelines.js';
import { tenants } from './tenants.js';

export const integrationAdapters = pgTable(
  'integration_adapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    pipelineId: uuid('pipeline_id').references(() => pipelines.id),
    kind: text('kind').notNull(),
    config: jsonb('config').notNull().default({}),
    subscriptions: text('subscriptions').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_integration_adapters_tenant').on(table.tenantId, table.isActive),
    index('idx_integration_adapters_pipeline').on(table.tenantId, table.pipelineId),
  ],
);
