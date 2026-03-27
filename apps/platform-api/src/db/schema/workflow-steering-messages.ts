import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowInputPackets } from './workflow-input-packets.js';
import { workflowInterventions } from './workflow-interventions.js';
import { workflowOperatorUpdates } from './workflow-operator-updates.js';
import { workflowSteeringSessions } from './workflow-steering-sessions.js';
import { workflowWorkItems } from './workflow-work-items.js';

export const workflowSteeringMessages = pgTable(
  'workflow_steering_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    steeringSessionId: uuid('steering_session_id')
      .notNull()
      .references(() => workflowSteeringSessions.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').notNull(),
    messageKind: text('message_kind').notNull(),
    headline: text('headline').notNull(),
    body: text('body'),
    linkedInterventionId: uuid('linked_intervention_id').references(() => workflowInterventions.id, {
      onDelete: 'set null',
    }),
    linkedInputPacketId: uuid('linked_input_packet_id').references(() => workflowInputPackets.id, {
      onDelete: 'set null',
    }),
    linkedOperatorUpdateId: uuid('linked_operator_update_id').references(() => workflowOperatorUpdates.id, {
      onDelete: 'set null',
    }),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_steering_messages_session').on(table.tenantId, table.steeringSessionId, table.createdAt),
    index('idx_workflow_steering_messages_workflow').on(table.tenantId, table.workflowId),
    index('idx_workflow_steering_messages_work_item')
      .on(table.tenantId, table.workflowId, table.workItemId, table.createdAt)
      .where(sql`${table.workItemId} IS NOT NULL`),
  ],
);
