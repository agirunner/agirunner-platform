import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { llmModels } from './llm-models.js';
import { tenants } from './tenants.js';

export const roleModelAssignments = pgTable(
  'role_model_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    roleName: text('role_name').notNull(),
    primaryModelId: uuid('primary_model_id').references(() => llmModels.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_role_model_assignments_tenant').on(table.tenantId),
    index('idx_role_model_assignments_role').on(table.tenantId, table.roleName),
    index('idx_role_model_assignments_model')
      .on(table.primaryModelId)
      .where(sql`${table.primaryModelId} IS NOT NULL`),
  ],
);
