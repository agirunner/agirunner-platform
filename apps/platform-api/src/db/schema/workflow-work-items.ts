import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { taskPriorityEnum } from './enums.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const workflowWorkItems = pgTable(
  'workflow_work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    parentWorkItemId: uuid('parent_work_item_id').references((): AnyPgColumn => workflowWorkItems.id),
    stageName: text('stage_name').notNull(),
    currentCheckpoint: text('current_checkpoint'),
    title: text('title').notNull(),
    goal: text('goal'),
    acceptanceCriteria: text('acceptance_criteria'),
    columnId: text('column_id').notNull(),
    ownerRole: text('owner_role'),
    nextExpectedActor: text('next_expected_actor'),
    nextExpectedAction: text('next_expected_action'),
    reworkCount: integer('rework_count').notNull().default(0),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    requestId: text('request_id'),
    notes: text('notes'),
    createdBy: text('created_by').notNull().default('manual'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_work_items_tenant_workflow').on(table.tenantId, table.workflowId, table.createdAt),
    index('idx_workflow_work_items_stage').on(table.tenantId, table.workflowId, table.stageName),
    index('idx_workflow_work_items_column').on(table.tenantId, table.workflowId, table.columnId),
    uniqueIndex('idx_workflow_work_items_request_id')
      .on(table.tenantId, table.workflowId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
  ],
);
