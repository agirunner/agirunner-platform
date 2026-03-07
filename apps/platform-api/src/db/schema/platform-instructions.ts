import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const platformInstructions = pgTable(
  'platform_instructions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    version: integer('version').notNull().default(0),
    content: text('content').notNull().default(''),
    format: text('format').notNull().default('text'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByType: text('updated_by_type'),
    updatedById: text('updated_by_id'),
  },
  (table) => [primaryKey({ columns: [table.tenantId], name: 'pk_platform_instructions' })],
);

export const platformInstructionVersions = pgTable(
  'platform_instruction_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    format: text('format').notNull().default('text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByType: text('created_by_type'),
    createdById: text('created_by_id'),
  },
  (table) => [
    index('idx_platform_instruction_versions_tenant').on(table.tenantId, table.version),
  ],
);
