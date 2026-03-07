import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { integrationAdapters } from './integration-adapters.js';
import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const integrationActions = pgTable(
  'integration_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    adapterId: uuid('adapter_id')
      .notNull()
      .references(() => integrationAdapters.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    actionType: text('action_type').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_integration_actions_lookup').on(table.tokenHash, table.expiresAt),
    index('idx_integration_actions_task').on(
      table.tenantId,
      table.taskId,
      table.actionType,
      table.createdAt,
    ),
  ],
);
