import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { pipelines } from './pipelines.js';
import { tenants } from './tenants.js';

export const orchestratorGrants = pgTable(
  'orchestrator_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    permissions: text('permissions').array().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_orchestrator_grants_agent_pipeline')
      .on(table.agentId, table.pipelineId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('idx_orchestrator_grants_tenant').on(table.tenantId),
  ],
);
