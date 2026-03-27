import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const workflowInputPackets = pgTable(
  'workflow_input_packets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    packetKind: text('packet_kind').notNull(),
    source: text('source').notNull().default('operator'),
    summary: text('summary'),
    structuredInputs: jsonb('structured_inputs').notNull().default({}),
    metadata: jsonb('metadata').notNull().default({}),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_input_packets_tenant_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_input_packets_work_item').on(table.tenantId, table.workItemId),
  ],
);
