import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const executionEnvironmentCatalog = pgTable(
  'execution_environment_catalog',
  {
    catalogKey: text('catalog_key').notNull(),
    catalogVersion: integer('catalog_version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    image: text('image').notNull(),
    cpu: text('cpu').notNull(),
    memory: text('memory').notNull(),
    pullPolicy: text('pull_policy').notNull(),
    bootstrapCommands: jsonb('bootstrap_commands').notNull().default([]),
    bootstrapRequiredDomains: jsonb('bootstrap_required_domains').notNull().default([]),
    declaredMetadata: jsonb('declared_metadata').notNull().default({}),
    supportStatus: text('support_status').notNull(),
    replacementCatalogKey: text('replacement_catalog_key'),
    replacementCatalogVersion: integer('replacement_catalog_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'pk_execution_environment_catalog',
      columns: [table.catalogKey, table.catalogVersion],
    }),
    index('idx_execution_environment_catalog_support_status').on(table.supportStatus),
  ],
);
