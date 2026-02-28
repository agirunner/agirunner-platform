import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { tenants } from './tenants.js';

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    schema: jsonb('schema').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_template_tenant_slug_version').on(table.tenantId, table.slug, table.version),
    index('idx_templates_tenant').on(table.tenantId),
    index('idx_templates_built_in')
      .on(table.isBuiltIn)
      .where(sql`${table.isBuiltIn} = true`),
  ],
);
