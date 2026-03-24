import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { apiKeyScopeEnum } from './enums.js';
import { tenants } from './tenants.js';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    keyHash: text('key_hash').notNull(),
    keyLookupHash: varchar('key_lookup_hash', { length: 64 }),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    scope: apiKeyScopeEnum('scope').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id'),
    label: text('label'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isRevoked: boolean('is_revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_api_keys_lookup_hash').on(table.keyLookupHash),
    uniqueIndex('idx_api_keys_prefix').on(table.keyPrefix),
    index('idx_api_keys_tenant').on(table.tenantId),
    index('idx_api_keys_owner').on(table.ownerType, table.ownerId),
  ],
);
