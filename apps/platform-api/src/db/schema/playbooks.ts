import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const playbooks = pgTable(
  'playbooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    outcome: text('outcome').notNull(),
    lifecycle: text('lifecycle').notNull().default('planned'),
    version: integer('version').notNull().default(1),
    definition: jsonb('definition').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_playbooks_tenant_slug_version').on(table.tenantId, table.slug, table.version),
    index('idx_playbooks_tenant_active').on(table.tenantId, table.isActive, table.createdAt),
    check('playbooks_lifecycle_check', sql`${table.lifecycle} IN ('planned', 'ongoing')`),
  ],
);
