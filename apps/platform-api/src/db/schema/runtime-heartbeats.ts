import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { playbooks } from './playbooks.js';
import { tenants } from './tenants.js';

export const runtimeHeartbeats = pgTable(
  'runtime_heartbeats',
  {
    runtimeId: uuid('runtime_id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    playbookId: uuid('playbook_id').references(() => playbooks.id, { onDelete: 'cascade' }),
    poolKind: text('pool_kind').notNull().default('specialist'),
    state: text('state').notNull().default('idle'),
    taskId: uuid('task_id'),
    uptimeSeconds: integer('uptime_seconds').notNull().default(0),
    lastClaimAt: timestamp('last_claim_at', { withTimezone: true }),
    image: text('image').notNull(),
    drainRequested: boolean('drain_requested').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_runtime_heartbeats_tenant').on(table.tenantId),
    index('idx_runtime_heartbeats_playbook').on(table.playbookId),
    index('idx_runtime_heartbeats_tenant_pool').on(table.tenantId, table.poolKind),
    index('idx_runtime_heartbeats_state').on(table.state),
  ],
);
