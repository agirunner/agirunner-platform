import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowInterventions } from './workflow-interventions.js';

export const workflowInterventionFiles = pgTable(
  'workflow_intervention_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    interventionId: uuid('intervention_id')
      .notNull()
      .references(() => workflowInterventions.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    description: text('description'),
    storageBackend: text('storage_backend').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_intervention_files_intervention').on(table.tenantId, table.interventionId, table.createdAt),
    index('idx_workflow_intervention_files_workflow').on(table.tenantId, table.workflowId),
  ],
);
