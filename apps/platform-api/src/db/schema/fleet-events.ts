import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const fleetEvents = pgTable(
  'fleet_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventType: text('event_type').notNull(),
    level: text('level').notNull().default('info'),
    runtimeId: uuid('runtime_id'),
    templateId: uuid('template_id'),
    taskId: uuid('task_id'),
    workflowId: uuid('workflow_id'),
    containerId: text('container_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fleet_events_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_fleet_events_template').on(table.templateId, table.createdAt),
    index('idx_fleet_events_runtime').on(table.runtimeId, table.createdAt),
    index('idx_fleet_events_type').on(table.eventType),
  ],
);
