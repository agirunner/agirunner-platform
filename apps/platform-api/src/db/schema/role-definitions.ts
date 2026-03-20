import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    fallbackModel: text('fallback_model'),
    verificationStrategy: text('verification_strategy'),
    capabilities: text('capabilities').array().default([]),
    executionContainerConfig: jsonb('execution_container_config'),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
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
