import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workflows } from './workflows.js';
import { workspaces } from './workspaces.js';
import { tenants } from './tenants.js';

export const webhookWorkItemTriggers = pgTable(
  'webhook_work_item_triggers',
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
    eventHeader: text('event_header'),
    eventTypes: text('event_types').array().notNull().default([]),
    signatureHeader: text('signature_header').notNull(),
    signatureMode: text('signature_mode').notNull(),
    secret: text('secret').notNull(),
    fieldMappings: jsonb('field_mappings').notNull().default({}),
    defaults: jsonb('defaults').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_work_item_triggers_tenant').on(table.tenantId, table.isActive, table.createdAt),
    index('idx_webhook_work_item_triggers_workflow').on(table.workflowId),
    index('idx_webhook_work_item_triggers_workspace').on(table.workspaceId),
  ],
);
