import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { executionBackendEnum } from './enums.js';

export const liveContainerInventory = pgTable(
  'live_container_inventory',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    containerId: text('container_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    status: text('status').notNull(),
    image: text('image').notNull(),
    cpuLimit: text('cpu_limit'),
    memoryLimit: text('memory_limit'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    desiredStateId: uuid('desired_state_id'),
    runtimeId: text('runtime_id'),
    taskId: uuid('task_id'),
    workflowId: uuid('workflow_id'),
    executionBackend: executionBackendEnum('execution_backend'),
    roleName: text('role_name'),
    playbookId: text('playbook_id'),
    playbookName: text('playbook_name'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.containerId], name: 'pk_live_container_inventory' }),
    index('idx_live_container_inventory_tenant').on(table.tenantId, table.lastSeenAt),
    index('idx_live_container_inventory_kind').on(table.tenantId, table.kind, table.lastSeenAt),
    index('idx_live_container_inventory_runtime').on(table.tenantId, table.runtimeId),
    index('idx_live_container_inventory_task').on(table.tenantId, table.taskId),
    index('idx_live_container_inventory_execution_backend').on(
      table.tenantId,
      table.executionBackend,
      table.lastSeenAt,
    ),
  ],
);
