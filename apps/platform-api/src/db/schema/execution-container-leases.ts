import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const executionContainerLeases = pgTable(
  'execution_container_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id'),
    workItemId: uuid('work_item_id'),
    roleName: text('role_name').notNull(),
    agentId: text('agent_id'),
    workerId: text('worker_id'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedReason: text('released_reason'),
  },
  (table) => [
    index('idx_execution_container_leases_tenant_active').on(table.tenantId, table.releasedAt),
    index('idx_execution_container_leases_task').on(table.taskId),
  ],
);
