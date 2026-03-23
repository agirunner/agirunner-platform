import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const workflowBranches = pgTable(
  'workflow_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    parentBranchId: uuid('parent_branch_id').references((): AnyPgColumn => workflowBranches.id),
    parentSubjectRef: jsonb('parent_subject_ref').notNull().default({}),
    branchKey: text('branch_key').notNull(),
    branchStatus: text('branch_status').notNull().default('active'),
    terminationPolicy: text('termination_policy').notNull(),
    createdByTaskId: uuid('created_by_task_id'),
    terminatedByType: text('terminated_by_type'),
    terminatedById: text('terminated_by_id'),
    terminationReason: text('termination_reason'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_branches_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_branches_status').on(table.tenantId, table.workflowId, table.branchStatus, table.createdAt),
    index('idx_workflow_branches_parent')
      .on(table.tenantId, table.workflowId, table.parentBranchId)
      .where(sql`${table.parentBranchId} IS NOT NULL`),
    index('idx_workflow_branches_key').on(table.tenantId, table.workflowId, table.branchKey),
  ],
);
