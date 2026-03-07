import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pipelineArtifacts } from './pipeline-artifacts.js';
import { pipelines } from './pipelines.js';
import { projects } from './projects.js';
import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const pipelineDocuments = pgTable(
  'pipeline_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    projectId: uuid('project_id').references(() => projects.id),
    taskId: uuid('task_id').references(() => tasks.id),
    logicalName: text('logical_name').notNull(),
    source: text('source').notNull(),
    location: text('location').notNull(),
    artifactId: uuid('artifact_id').references(() => pipelineArtifacts.id),
    contentType: text('content_type'),
    title: text('title'),
    description: text('description'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pipeline_documents_tenant_pipeline').on(table.tenantId, table.pipelineId, table.createdAt),
    index('idx_pipeline_documents_tenant_task').on(table.tenantId, table.taskId),
  ],
);
