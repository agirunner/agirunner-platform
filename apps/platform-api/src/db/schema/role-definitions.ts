import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { executionEnvironments } from './execution-environments.js';
import { tenants } from './tenants.js';

export const roleDefinitions = pgTable(
  'role_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    allowedTools: text('allowed_tools').array().default([]),
    modelPreference: text('model_preference'),
    verificationStrategy: text('verification_strategy'),
    executionEnvironmentId: uuid('execution_environment_id').references(
      () => executionEnvironments.id,
    ),
    escalationTarget: text('escalation_target'),
    maxEscalationDepth: integer('max_escalation_depth').notNull().default(5),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_role_definitions_tenant').on(table.tenantId),
    index('idx_role_definitions_active').on(table.tenantId, table.isActive),
  ],
);
