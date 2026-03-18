import { index, jsonb, pgTable, uniqueIndex, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';

import { workspaces } from './workspaces.js';
import { tenants } from './tenants.js';

export const workspaceSpecVersions = pgTable(
  'workspace_spec_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    version: integer('version').notNull(),
    spec: jsonb('spec').notNull().default({}),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_workspace_spec_versions_workspace_version').on(table.workspaceId, table.version),
    index('idx_workspace_spec_versions_tenant_workspace').on(table.tenantId, table.workspaceId, table.version),
  ],
);
