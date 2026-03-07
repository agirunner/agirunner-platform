import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name'),
    role: text('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_users_tenant').on(table.tenantId),
    emailIdx: index('idx_users_email').on(table.email),
    tenantEmailUnique: unique('users_tenant_id_email_key').on(table.tenantId, table.email),
  }),
);
