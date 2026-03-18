import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workspaces } from './workspaces.js';
import { playbooks } from './playbooks.js';
import { workflowStateEnum } from './enums.js';
import { tenants } from './tenants.js';

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    playbookId: uuid('playbook_id').references(() => playbooks.id),
    playbookVersion: integer('playbook_version'),
    workspaceSpecVersion: integer('workspace_spec_version'),
    name: text('name').notNull(),
    state: workflowStateEnum('state').notNull().default('pending'),
    lifecycle: text('lifecycle'),
    currentStage: text('current_stage'),
    parameters: jsonb('parameters').notNull().default({}),
    context: jsonb('context').notNull().default({}),
    contextSizeBytes: integer('context_size_bytes').notNull().default(0),
    contextMaxBytes: integer('context_max_bytes').notNull().default(5242880),
    resolvedConfig: jsonb('resolved_config').notNull().default({}),
    configLayers: jsonb('config_layers').notNull().default({}),
    instructionConfig: jsonb('instruction_config'),
    orchestrationState: jsonb('orchestration_state').notNull().default({}),
    gitBranch: text('git_branch'),
    tokenBudget: integer('token_budget'),
    costCapUsd: numeric('cost_cap_usd', { precision: 10, scale: 4 }),
    maxDurationMinutes: integer('max_duration_minutes'),
    legalHold: boolean('legal_hold').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflows_tenant').on(table.tenantId),
    index('idx_workflows_workspace').on(table.workspaceId),
    index('idx_workflows_state').on(table.tenantId, table.state),
    index('idx_workflows_playbook').on(table.playbookId),
    check(
      'workflows_lifecycle_check',
      sql`${table.lifecycle} IS NULL OR ${table.lifecycle} IN ('planned', 'ongoing')`,
    ),
    check(
      'chk_workflows_ongoing_current_stage_null',
      sql`(${table.lifecycle} IS DISTINCT FROM 'ongoing' OR ${table.currentStage} IS NULL)`,
    ),
  ],
);
