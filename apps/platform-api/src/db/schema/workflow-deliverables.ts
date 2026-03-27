import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { tenants } from './tenants.js';
import { workflowOperatorBriefs } from './workflow-operator-briefs.js';
import { workflowWorkItems } from './workflow-work-items.js';
import { workflows } from './workflows.js';

export const workflowOutputDescriptors = pgTable(
  'workflow_output_descriptors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workflowWorkItems.id, { onDelete: 'set null' }),
    descriptorKind: text('descriptor_kind').notNull(),
    deliveryStage: text('delivery_stage').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    summaryBrief: text('summary_brief'),
    previewCapabilitiesJson: jsonb('preview_capabilities_json').notNull().default({}),
    primaryTargetJson: jsonb('primary_target_json').notNull().default({}),
    secondaryTargetsJson: jsonb('secondary_targets_json').notNull().default([]),
    contentPreviewJson: jsonb('content_preview_json').notNull().default({}),
    sourceBriefId: uuid('source_brief_id').references(() => workflowOperatorBriefs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_output_descriptors_workflow').on(table.tenantId, table.workflowId, table.updatedAt),
    index('idx_workflow_output_descriptors_work_item').on(table.tenantId, table.workItemId),
    check(
      'workflow_output_descriptors_delivery_stage_check',
      sql`${table.deliveryStage} IN ('in_progress', 'final')`,
    ),
    check(
      'workflow_output_descriptors_state_check',
      sql`${table.state} IN ('draft', 'under_review', 'approved', 'superseded', 'final')`,
    ),
  ],
);
