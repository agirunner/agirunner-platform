import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { agentStatusEnum } from './enums.js';
import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workers } from './workers.js';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workerId: uuid('worker_id').references(() => workers.id),
    name: text('name').notNull(),
    capabilities: text('capabilities').array().notNull().default([]),
    status: agentStatusEnum('status').notNull().default('idle'),
    currentTaskId: uuid('current_task_id').references((): AnyPgColumn => tasks.id),
    heartbeatIntervalSeconds: integer('heartbeat_interval_seconds').notNull().default(30),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_agents_tenant').on(table.tenantId),
    index('idx_agents_worker').on(table.workerId),
    index('idx_agents_status').on(table.tenantId, table.status),
    index('idx_agents_capabilities').using('gin', table.capabilities),
    index('idx_agents_current_task').on(table.currentTaskId).where(sql`${table.currentTaskId} IS NOT NULL`),
    index('idx_agents_tenant_worker').on(table.tenantId, table.workerId, table.createdAt),
  ],
);
