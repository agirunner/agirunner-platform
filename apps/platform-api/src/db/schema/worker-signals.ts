import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { tenants } from './tenants.js';
import { workers } from './workers.js';

export const workerSignals = pgTable(
  'worker_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workers.id),
    signalType: text('signal_type').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    data: jsonb('data').notNull().default({}),
    delivered: boolean('delivered').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_worker_signals_pending').on(table.workerId, table.delivered).where(sql`${table.delivered} = false`)],
);
