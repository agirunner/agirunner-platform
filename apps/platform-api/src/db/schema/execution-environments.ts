import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const executionEnvironments = pgTable(
  'execution_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sourceKind: text('source_kind').notNull(),
    catalogKey: text('catalog_key'),
    catalogVersion: integer('catalog_version'),
    image: text('image').notNull(),
    cpu: text('cpu').notNull(),
    memory: text('memory').notNull(),
    pullPolicy: text('pull_policy').notNull(),
    bootstrapCommands: jsonb('bootstrap_commands').notNull().default([]),
    bootstrapRequiredDomains: jsonb('bootstrap_required_domains').notNull().default([]),
    operatorNotes: text('operator_notes'),
    declaredMetadata: jsonb('declared_metadata').notNull().default({}),
    verifiedMetadata: jsonb('verified_metadata').notNull().default({}),
    toolCapabilities: jsonb('tool_capabilities').notNull().default({}),
    compatibilityStatus: text('compatibility_status').notNull().default('unknown'),
    compatibilityErrors: jsonb('compatibility_errors').notNull().default([]),
    verificationContractVersion: text('verification_contract_version'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    isDefault: boolean('is_default').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    isClaimable: boolean('is_claimable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_execution_environments_tenant_slug').on(table.tenantId, table.slug),
    uniqueIndex('uq_execution_environments_tenant_default')
      .on(table.tenantId)
      .where(sql`${table.isDefault} = true`),
    index('idx_execution_environments_tenant').on(table.tenantId),
    index('idx_execution_environments_tenant_claimable').on(
      table.tenantId,
      table.isClaimable,
      table.isArchived,
    ),
    index('idx_execution_environments_catalog').on(table.catalogKey, table.catalogVersion),
  ],
);
