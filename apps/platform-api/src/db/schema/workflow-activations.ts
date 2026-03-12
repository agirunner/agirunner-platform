import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const workflowActivations = pgTable(
  'workflow_activations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    activationId: uuid('activation_id'),
    requestId: text('request_id'),
    reason: text('reason').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    state: text('state').notNull().default('queued'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    summary: text('summary'),
    error: jsonb('error'),
  },
  (table) => [
    index('idx_workflow_activations_queue').on(table.tenantId, table.workflowId, table.state, table.queuedAt),
    uniqueIndex('idx_workflow_activations_request_id')
      .on(table.tenantId, table.workflowId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    index('idx_workflow_activations_activation').on(table.tenantId, table.workflowId, table.activationId),
    index('idx_workflow_activations_consumed').on(table.tenantId, table.workflowId, table.consumedAt, table.queuedAt),
  ],
);
