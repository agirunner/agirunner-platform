import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';

export const taskToolResults = pgTable(
  'task_tool_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    requestId: text('request_id').notNull(),
    response: jsonb('response').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_task_tool_results_request').on(
      table.tenantId,
      table.taskId,
      table.toolName,
      table.requestId,
    ),
    index('idx_task_tool_results_task').on(table.tenantId, table.taskId, table.createdAt),
  ],
);
