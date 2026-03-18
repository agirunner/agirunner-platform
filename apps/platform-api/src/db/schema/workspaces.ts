import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import type { StoredWorkspaceSettings } from '../../services/workspace-settings.js';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    repositoryUrl: text('repository_url'),
    memory: jsonb('memory').notNull().default({}),
    memorySizeBytes: integer('memory_size_bytes').notNull().default(0),
    memoryMaxBytes: integer('memory_max_bytes').notNull().default(1048576),
    currentSpecVersion: integer('current_spec_version').notNull().default(0),
    settings: jsonb('settings')
      .$type<StoredWorkspaceSettings>()
      .notNull()
      .default({ credentials: {}, model_overrides: {} }),
    gitWebhookProvider: text('git_webhook_provider'),
    gitWebhookSecret: text('git_webhook_secret'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_workspace_tenant_slug').on(table.tenantId, table.slug),
    index('idx_workspaces_tenant').on(table.tenantId),
  ],
);
