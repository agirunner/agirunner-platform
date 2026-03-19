import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { llmProviders } from './llm-providers.js';
import { tenants } from './tenants.js';

export const llmModels = pgTable(
  'llm_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => llmProviders.id),
    modelId: text('model_id').notNull(),
    contextWindow: integer('context_window'),
    maxOutputTokens: integer('max_output_tokens'),
    supportsToolUse: boolean('supports_tool_use').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    inputCostPerMillionUsd: numeric('input_cost_per_million_usd'),
    outputCostPerMillionUsd: numeric('output_cost_per_million_usd'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_llm_models_tenant').on(table.tenantId),
    index('idx_llm_models_provider').on(table.providerId),
    index('idx_llm_models_model_id').on(table.tenantId, table.modelId),
  ],
);
