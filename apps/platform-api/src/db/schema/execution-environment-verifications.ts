import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { executionEnvironments } from './execution-environments.js';
import { tenants } from './tenants.js';

export const executionEnvironmentVerifications = pgTable(
  'execution_environment_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    executionEnvironmentId: uuid('execution_environment_id')
      .notNull()
      .references(() => executionEnvironments.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    contractVersion: text('contract_version').notNull(),
    image: text('image').notNull(),
    probeOutput: jsonb('probe_output').notNull().default({}),
    errors: jsonb('errors').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_execution_environment_verifications_environment').on(
      table.executionEnvironmentId,
      table.createdAt,
    ),
    index('idx_execution_environment_verifications_tenant').on(table.tenantId),
  ],
);
