import { index, jsonb, pgTable, text, timestamp, uuid, bigint } from 'drizzle-orm/pg-core';

import { workflows } from './workflows.js';
import { projects } from './projects.js';
import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const workflowArtifacts = pgTable(
  'workflow_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id').references(() => workflows.id),
    projectId: uuid('project_id').references(() => projects.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    logicalPath: text('logical_path').notNull(),
    storageBackend: text('storage_backend').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    retentionPolicy: jsonb('retention_policy').notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_artifacts_tenant_task').on(table.tenantId, table.taskId),
    index('idx_workflow_artifacts_tenant_workflow').on(table.tenantId, table.workflowId),
    index('idx_workflow_artifacts_tenant_path').on(table.tenantId, table.logicalPath),
  ],
);
