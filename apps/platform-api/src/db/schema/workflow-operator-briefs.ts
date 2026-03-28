import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workflowWorkItems } from './workflow-work-items.js';
import { workflows } from './workflows.js';

export const workflowOperatorBriefs = pgTable(
  'workflow_operator_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    executionContextId: text('execution_context_id').notNull(),
    briefKind: text('brief_kind').notNull(),
    briefScope: text('brief_scope').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceRoleName: text('source_role_name'),
    llmTurnCount: integer('llm_turn_count'),
    statusKind: text('status_kind').notNull(),
    shortBrief: jsonb('short_brief').notNull().default({}),
    detailedBriefJson: jsonb('detailed_brief_json').notNull().default({}),
    linkedTargetIds: jsonb('linked_target_ids').notNull().default([]),
    sequenceNumber: integer('sequence_number').notNull(),
    relatedArtifactIds: jsonb('related_artifact_ids').notNull().default([]),
    relatedOutputDescriptorIds: jsonb('related_output_descriptor_ids').notNull().default([]),
    relatedInterventionIds: jsonb('related_intervention_ids').notNull().default([]),
    canonicalWorkflowBriefId: uuid('canonical_workflow_brief_id').references(
      (): AnyPgColumn => workflowOperatorBriefs.id,
      { onDelete: 'set null' },
    ),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_operator_briefs_workflow_sequence').on(
      table.tenantId,
      table.workflowId,
      table.sequenceNumber,
    ),
    index('idx_workflow_operator_briefs_work_item').on(table.tenantId, table.workItemId),
    uniqueIndex('uq_workflow_operator_briefs_request').on(table.tenantId, table.workflowId, table.requestId),
    check('workflow_operator_briefs_sequence_positive', sql`${table.sequenceNumber} > 0`),
  ],
);
