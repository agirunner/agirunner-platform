import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { projects } from './projects.js';
import { pipelineStateEnum } from './enums.js';
import { templates } from './templates.js';
import { tenants } from './tenants.js';

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').references(() => projects.id),
    templateId: uuid('template_id').references(() => templates.id),
    templateVersion: integer('template_version'),
    projectSpecVersion: integer('project_spec_version'),
    name: text('name').notNull(),
    state: pipelineStateEnum('state').notNull().default('pending'),
    parameters: jsonb('parameters').notNull().default({}),
    context: jsonb('context').notNull().default({}),
    contextSizeBytes: integer('context_size_bytes').notNull().default(0),
    contextMaxBytes: integer('context_max_bytes').notNull().default(5242880),
    resolvedConfig: jsonb('resolved_config').notNull().default({}),
    configLayers: jsonb('config_layers').notNull().default({}),
    instructionConfig: jsonb('instruction_config'),
    gitBranch: text('git_branch'),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pipelines_tenant').on(table.tenantId),
    index('idx_pipelines_project').on(table.projectId),
    index('idx_pipelines_state').on(table.tenantId, table.state),
    index('idx_pipelines_template').on(table.templateId),
  ],
);
