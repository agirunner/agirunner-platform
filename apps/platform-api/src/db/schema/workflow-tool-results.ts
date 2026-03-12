import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

export const workflowToolResults = pgTable(
  'workflow_tool_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    toolName: text('tool_name').notNull(),
    requestId: text('request_id').notNull(),
    response: jsonb('response').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_workflow_tool_results_request').on(
      table.tenantId,
      table.workflowId,
      table.toolName,
      table.requestId,
    ),
    index('idx_workflow_tool_results_workflow').on(table.tenantId, table.workflowId, table.createdAt),
  ],
);
