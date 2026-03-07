import { index, jsonb, pgTable, uniqueIndex, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';

import { projects } from './projects.js';
import { tenants } from './tenants.js';

export const projectSpecVersions = pgTable(
  'project_spec_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    spec: jsonb('spec').notNull().default({}),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_project_spec_versions_project_version').on(table.projectId, table.version),
    index('idx_project_spec_versions_tenant_project').on(table.tenantId, table.projectId, table.version),
  ],
);
