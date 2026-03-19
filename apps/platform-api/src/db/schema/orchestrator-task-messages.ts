import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workers } from './workers.js';
import { workflowActivations } from './workflow-activations.js';
import { workflows } from './workflows.js';

export const orchestratorTaskMessages = pgTable(
  'orchestrator_task_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    orchestratorTaskId: uuid('orchestrator_task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id),
    activationId: uuid('activation_id').references(() => workflowActivations.id),
    stageName: text('stage_name'),
    workerId: uuid('worker_id').references(() => workers.id),
    requestId: text('request_id').notNull(),
    urgency: text('urgency').notNull(),
    message: text('message').notNull(),
    deliveryState: text('delivery_state').notNull().default('pending_delivery'),
    deliveryAttemptCount: integer('delivery_attempt_count').notNull().default(0),
    lastDeliveryAttemptAt: timestamp('last_delivery_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_orchestrator_task_messages_request')
      .on(table.tenantId, table.workflowId, table.requestId),
    index('idx_orchestrator_task_messages_task').on(table.tenantId, table.taskId),
    index('idx_orchestrator_task_messages_pending')
      .on(table.tenantId, table.workflowId, table.deliveryState)
      .where(sql`${table.deliveryState} IN ('pending_delivery', 'delivery_in_progress')`),
    index('idx_orchestrator_task_messages_orchestrator_task').on(
      table.tenantId,
      table.orchestratorTaskId,
    ),
    index('idx_orchestrator_task_messages_worker')
      .on(table.tenantId, table.workerId)
      .where(sql`${table.workerId} IS NOT NULL`),
  ],
);
