import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const remoteMcpOAuthClientProfiles = pgTable(
  'remote_mcp_oauth_client_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    issuer: text('issuer'),
    authorizationEndpoint: text('authorization_endpoint'),
    tokenEndpoint: text('token_endpoint').notNull(),
    registrationEndpoint: text('registration_endpoint'),
    deviceAuthorizationEndpoint: text('device_authorization_endpoint'),
    callbackMode: text('callback_mode').notNull().default('loopback'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
    clientId: text('client_id').notNull(),
    encryptedClientSecret: text('encrypted_client_secret'),
    defaultScopes: jsonb('default_scopes').notNull().default([]),
    defaultResourceIndicators: jsonb('default_resource_indicators').notNull().default([]),
    defaultAudiences: jsonb('default_audiences').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_remote_mcp_oauth_client_profiles_tenant_slug').on(table.tenantId, table.slug),
    index('idx_remote_mcp_oauth_client_profiles_tenant').on(table.tenantId),
  ],
);
