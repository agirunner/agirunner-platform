import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const workflowStages = pgTable(
  'workflow_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    goal: text('goal').notNull(),
    guidance: text('guidance'),
    humanGate: boolean('human_gate').notNull().default(false),
    status: text('status').notNull().default('pending'),
    gateStatus: text('gate_status').notNull().default('not_requested'),
    iterationCount: integer('iteration_count').notNull().default(0),
    summary: text('summary'),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_workflow_stages_workflow_name').on(table.tenantId, table.workflowId, table.name),
    index('idx_workflow_stages_workflow').on(table.tenantId, table.workflowId, table.position),
    index('idx_workflow_stages_status').on(table.tenantId, table.status),
  ],
);
