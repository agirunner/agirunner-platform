import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const oauthStates = pgTable(
  'oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull(),
    profileId: text('profile_id').notNull(),
    flowKind: text('flow_kind').notNull().default('llm_provider'),
    flowPayload: jsonb('flow_payload').notNull().default({}),
    state: text('state').notNull().unique(),
    codeVerifier: text('code_verifier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_oauth_states_state').on(table.state)],
);
