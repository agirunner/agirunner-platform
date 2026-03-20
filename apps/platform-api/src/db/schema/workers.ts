import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workerConnectionModeEnum, workerRuntimeTypeEnum, workerStatusEnum } from './enums.js';

export const workers = pgTable(
  'workers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    status: workerStatusEnum('status').notNull().default('online'),
    connectionMode: workerConnectionModeEnum('connection_mode').notNull().default('websocket'),
    runtimeType: workerRuntimeTypeEnum('runtime_type').notNull().default('external'),
    routingTags: text('routing_tags').array().notNull().default([]),
    hostInfo: jsonb('host_info').notNull().default({}),
    heartbeatIntervalSeconds: integer('heartbeat_interval_seconds').notNull().default(30),
    currentTaskId: uuid('current_task_id'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workers_tenant').on(table.tenantId),
    index('idx_workers_status').on(table.tenantId, table.status),
    index('idx_workers_routing_tags').using('gin', table.routingTags),
    index('idx_workers_heartbeat_timeout')
      .on(table.status, table.lastHeartbeatAt)
      .where(sql`${table.lastHeartbeatAt} IS NOT NULL`),
  ],
);
