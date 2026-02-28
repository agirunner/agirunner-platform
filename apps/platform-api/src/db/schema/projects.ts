import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    repositoryUrl: text('repository_url'),
    memory: jsonb('memory').notNull().default({}),
    memorySizeBytes: integer('memory_size_bytes').notNull().default(0),
    memoryMaxBytes: integer('memory_max_bytes').notNull().default(1048576),
    settings: jsonb('settings').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_project_tenant_slug').on(table.tenantId, table.slug),
    index('idx_projects_tenant').on(table.tenantId),
  ],
);
