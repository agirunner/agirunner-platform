import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workspaces } from './workspaces.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const scheduledWorkItemTriggers = pgTable(
  'scheduled_work_item_triggers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    source: text('source').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    scheduleType: text('schedule_type').notNull().default('interval'),
    cadenceMinutes: integer('cadence_minutes'),
    dailyTime: text('daily_time'),
    timezone: text('timezone'),
    defaults: jsonb('defaults').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }).notNull(),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_scheduled_work_item_triggers_due').on(table.tenantId, table.isActive, table.nextFireAt),
    index('idx_scheduled_work_item_triggers_lease').on(table.tenantId, table.leaseExpiresAt),
    index('idx_scheduled_work_item_triggers_workflow').on(table.workflowId),
    index('idx_scheduled_work_item_triggers_workspace').on(table.workspaceId),
  ],
);
