import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowInterventions } from './workflow-interventions.js';
import { workflowSteeringSessions } from './workflow-steering-sessions.js';

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
    steeringSessionId: uuid('steering_session_id')
      .notNull()
      .references(() => workflowSteeringSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    structuredProposal: jsonb('structured_proposal').notNull().default({}),
    interventionId: uuid('intervention_id').references(() => workflowInterventions.id, { onDelete: 'set null' }),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_steering_messages_session').on(table.tenantId, table.steeringSessionId, table.createdAt),
    index('idx_workflow_steering_messages_workflow').on(table.tenantId, table.workflowId),
  ],
);
