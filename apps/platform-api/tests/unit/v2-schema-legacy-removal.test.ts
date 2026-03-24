import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { eventEntityTypeEnum } from '../../src/db/schema/enums.js';
import { tasks } from '../../src/db/schema/tasks.js';

const initMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0001_init.sql';
const executionLogContextMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0007_execution_log_workflow_context.sql';
const fleetPlaybookMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0008_fleet_playbook_contract.sql';
const webhookWorkItemMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0009_webhook_work_item_triggers.sql';
const droppedTemplateMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0010_drop_templates.sql';

describe('v2 schema legacy removal', () => {
  it('removes template entity values from the canonical schema enum', () => {
    expect(eventEntityTypeEnum.enumValues).not.toContain('template');
  });

  it('does not recreate template tables or phase-era columns in the base migration', () => {
    const source = readFileSync(initMigrationPath, 'utf8');

    expect(source).not.toContain('CREATE TABLE public.templates');
    expect(source).not.toContain('CREATE TABLE public.webhook_task_triggers');
    expect(source).not.toContain('CREATE TABLE public.webhook_task_trigger_invocations');
    expect(source).not.toContain('template_id uuid');
    expect(source).not.toContain('template_version integer');
    expect(source).not.toContain('workflow_phase text');
    expect(source).not.toContain('idx_workflows_template');
    expect(source).not.toContain('idx_runtime_heartbeats_template');
    expect(source).not.toContain('idx_fleet_events_template');
    expect(source).not.toContain('workflows_template_id_fkey');
    expect(source).not.toContain('runtime_heartbeats_template_id_fkey');
    expect(source).not.toContain('requires_approval boolean');
    expect(source).not.toContain('requires_assessment boolean');
  });

  it('removes legacy task governance columns from the canonical tasks schema', () => {
    expect(tasks).not.toHaveProperty('requiresApproval');
    expect(tasks).not.toHaveProperty('requiresAssessment');
  });

  it('keeps follow-on cleanup migrations V2-only once the base schema is clean', () => {
    const executionLogMigration = readFileSync(executionLogContextMigrationPath, 'utf8');
    const fleetPlaybookMigration = readFileSync(fleetPlaybookMigrationPath, 'utf8');
    const webhookWorkItemMigration = readFileSync(webhookWorkItemMigrationPath, 'utf8');

    expect(executionLogMigration).not.toContain('information_schema.columns');
    expect(executionLogMigration).not.toContain("column_name = 'workflow_phase'");
    expect(executionLogMigration).toContain('ADD COLUMN stage_name text');
    expect(fleetPlaybookMigration).not.toContain("column_name = 'template_id'");
    expect(fleetPlaybookMigration).not.toContain('idx_runtime_heartbeats_template');
    expect(fleetPlaybookMigration).not.toContain('idx_fleet_events_template');
    expect(fleetPlaybookMigration).toContain('The canonical base schema is already playbook-based.');
    expect(webhookWorkItemMigration).not.toContain('webhook_task_triggers');
    expect(webhookWorkItemMigration).not.toContain('webhook_task_trigger_invocations');
    expect(webhookWorkItemMigration).toContain('CREATE TABLE IF NOT EXISTS webhook_work_item_triggers');
    expect(existsSync(droppedTemplateMigrationPath)).toBe(false);
  });
});
