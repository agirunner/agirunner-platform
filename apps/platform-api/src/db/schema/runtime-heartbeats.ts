import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { templates } from './templates.js';

export const runtimeHeartbeats = pgTable(
  'runtime_heartbeats',
  {
    runtimeId: uuid('runtime_id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
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
    index('idx_runtime_heartbeats_template').on(table.templateId),
    index('idx_runtime_heartbeats_state').on(table.state),
  ],
);
