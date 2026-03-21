import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const workerDesiredState = pgTable(
  'worker_desired_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workerName: text('worker_name').notNull(),
    role: text('role').notNull(),
    poolKind: text('pool_kind').notNull().default('specialist'),
    runtimeImage: text('runtime_image').notNull(),
    cpuLimit: text('cpu_limit').notNull().default('2'),
    memoryLimit: text('memory_limit').notNull().default('128m'),
    networkPolicy: text('network_policy').notNull().default('restricted'),
    environment: jsonb('environment').default({}),
    llmProvider: text('llm_provider'),
    llmModel: text('llm_model'),
    llmApiKeySecretRef: text('llm_api_key_secret_ref'),
    replicas: integer('replicas').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    restartRequested: boolean('restart_requested').notNull().default(false),
    draining: boolean('draining').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_worker_desired_state_tenant').on(table.tenantId),
    index('idx_worker_desired_state_tenant_pool').on(table.tenantId, table.poolKind),
  ],
);
