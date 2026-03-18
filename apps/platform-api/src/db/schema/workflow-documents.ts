import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workflowArtifacts } from './workflow-artifacts.js';
import { workflows } from './workflows.js';
import { workspaces } from './workspaces.js';
import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const workflowDocuments = pgTable(
  'workflow_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    taskId: uuid('task_id').references(() => tasks.id),
    logicalName: text('logical_name').notNull(),
    source: text('source').notNull(),
    location: text('location').notNull(),
    artifactId: uuid('artifact_id').references(() => workflowArtifacts.id),
    contentType: text('content_type'),
    title: text('title'),
    description: text('description'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_documents_tenant_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_documents_tenant_task').on(table.tenantId, table.taskId),
  ],
);
