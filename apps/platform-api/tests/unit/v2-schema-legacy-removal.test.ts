import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { eventEntityTypeEnum } from '../../src/db/schema/enums.js';

const initMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0001_init.sql';
const executionLogContextMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0007_execution_log_workflow_context.sql';
const fleetPlaybookMigrationPath =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0008_fleet_playbook_contract.sql';

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
  });

  it('keeps follow-on cleanup migrations tolerant of a clean base schema', () => {
    const executionLogMigration = readFileSync(executionLogContextMigrationPath, 'utf8');
    const fleetPlaybookMigration = readFileSync(fleetPlaybookMigrationPath, 'utf8');
    const webhookWorkItemMigration = readFileSync(
      '/home/mark/codex/agirunner-platform/apps/platform-api/src/db/migrations/0009_webhook_work_item_triggers.sql',
      'utf8',
    );

    expect(executionLogMigration).toContain('information_schema.columns');
    expect(executionLogMigration).toContain("column_name = 'workflow_phase'");
    expect(fleetPlaybookMigration).toContain("column_name = 'template_id'");
    expect(fleetPlaybookMigration).toContain('DROP INDEX IF EXISTS idx_runtime_heartbeats_playbook');
    expect(fleetPlaybookMigration).toContain('DROP INDEX IF EXISTS idx_fleet_events_playbook');
    expect(webhookWorkItemMigration).toContain('DROP TABLE IF EXISTS webhook_task_triggers');
    expect(webhookWorkItemMigration).toContain('CREATE TABLE IF NOT EXISTS webhook_work_item_triggers');
  });
});
