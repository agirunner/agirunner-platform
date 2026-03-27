import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const remoteMcpServers = pgTable(
  'remote_mcp_servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    endpointUrl: text('endpoint_url').notNull(),
    callTimeoutSeconds: integer('call_timeout_seconds').notNull().default(300),
    authMode: text('auth_mode').notNull(),
    enabledByDefaultForNewSpecialists: boolean('enabled_by_default_for_new_specialists').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    verificationStatus: text('verification_status').notNull().default('unknown'),
    verificationError: text('verification_error'),
    verifiedTransport: text('verified_transport'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationContractVersion: text('verification_contract_version').notNull().default('remote-mcp-v1'),
    discoveredToolsSnapshot: jsonb('discovered_tools_snapshot').notNull().default([]),
    oauthConfig: jsonb('oauth_config'),
    oauthCredentials: jsonb('oauth_credentials'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_remote_mcp_servers_tenant_slug').on(table.tenantId, table.slug),
    index('idx_remote_mcp_servers_tenant').on(table.tenantId, table.isArchived, table.verificationStatus),
  ],
);
