import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

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
    rootWorkflowId: uuid('root_workflow_id').references((): AnyPgColumn => workflows.id),
    previousAttemptWorkflowId: uuid('previous_attempt_workflow_id').references((): AnyPgColumn => workflows.id),
    attemptNumber: integer('attempt_number').notNull().default(1),
    attemptKind: text('attempt_kind').notNull().default('initial'),
    completionCallouts: jsonb('completion_callouts').notNull().default({}),
    liveVisibilityModeOverride: text('live_visibility_mode_override'),
    liveVisibilityRevision: integer('live_visibility_revision').notNull().default(0),
    liveVisibilityUpdatedByOperatorId: text('live_visibility_updated_by_operator_id'),
    liveVisibilityUpdatedAt: timestamp('live_visibility_updated_at', { withTimezone: true }),
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
    index('idx_workflows_attempt_root').on(table.tenantId, table.rootWorkflowId, table.attemptNumber),
    index('idx_workflows_previous_attempt').on(table.tenantId, table.previousAttemptWorkflowId),
    check(
      'workflows_lifecycle_check',
      sql`${table.lifecycle} IS NULL OR ${table.lifecycle} IN ('planned', 'ongoing')`,
    ),
    check(
      'chk_workflows_ongoing_current_stage_null',
      sql`(${table.lifecycle} IS DISTINCT FROM 'ongoing' OR ${table.currentStage} IS NULL)`,
    ),
    check('workflows_attempt_number_positive', sql`${table.attemptNumber} > 0`),
    check(
      'workflows_attempt_kind_check',
      sql`${table.attemptKind} IN ('initial', 'redrive')`,
    ),
    check(
      'workflows_live_visibility_mode_override_check',
      sql`${table.liveVisibilityModeOverride} IS NULL OR ${table.liveVisibilityModeOverride} IN ('standard', 'enhanced')`,
    ),
  ],
);
