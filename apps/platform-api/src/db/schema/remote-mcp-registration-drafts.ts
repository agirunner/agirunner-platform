import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const remoteMcpRegistrationDrafts = pgTable(
  'remote_mcp_registration_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    endpointUrl: text('endpoint_url').notNull(),
    authMode: text('auth_mode').notNull(),
    enabledByDefaultForNewSpecialists: boolean('enabled_by_default_for_new_specialists').notNull().default(false),
    grantToAllExistingSpecialists: boolean('grant_to_all_existing_specialists').notNull().default(false),
    parameters: jsonb('parameters').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_remote_mcp_registration_drafts_tenant_user').on(table.tenantId, table.userId)],
);
