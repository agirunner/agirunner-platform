import { bigint, index, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workerDesiredState } from './worker-desired-state.js';

export const workerActualState = pgTable(
  'worker_actual_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    desiredStateId: uuid('desired_state_id')
      .notNull()
      .references(() => workerDesiredState.id, { onDelete: 'cascade' }),
    containerId: text('container_id'),
    containerStatus: text('container_status'),
    cpuUsagePercent: real('cpu_usage_percent'),
    memoryUsageBytes: bigint('memory_usage_bytes', { mode: 'number' }),
    networkRxBytes: bigint('network_rx_bytes', { mode: 'number' }),
    networkTxBytes: bigint('network_tx_bytes', { mode: 'number' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_worker_actual_state_desired').on(table.desiredStateId)],
);
