import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    requestId: text('request_id'),
    sourceIp: text('source_ip'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_tenant_time').on(table.tenantId, table.createdAt),
    index('idx_audit_logs_actor').on(table.tenantId, table.actorId, table.createdAt),
    index('idx_audit_logs_action').on(table.tenantId, table.action, table.createdAt),
    index('idx_audit_logs_resource').on(table.tenantId, table.resourceId, table.createdAt),
  ],
);
