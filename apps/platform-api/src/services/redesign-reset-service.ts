import type { DatabaseClient, DatabasePool } from '../db/database.js';

import { seedConfigTables } from '../bootstrap/seed.js';
import {
  DEFAULT_ADMIN_KEY_PREFIX,
  seedDefaultTenant,
} from '../db/seed.js';

export const PLAYBOOK_REDESIGN_PRESERVED_TABLES = [
  'api_keys',
  'llm_providers',
  'llm_models',
  'role_model_assignments',
  'tenants',
] as const;

export const PLAYBOOK_REDESIGN_RESET_TABLES = [
  'agents',
  'container_images',
  'events',
  'execution_logs',
  'fleet_events',
  'integration_actions',
  'integration_adapter_deliveries',
  'integration_adapters',
  'integration_resource_links',
  'oauth_states',
  'orchestrator_config',
  'orchestrator_grants',
  'orchestrator_task_messages',
  'platform_instructions',
  'playbooks',
  'project_artifact_files',
  'project_spec_versions',
  'projects',
  'role_definitions',
  'runtime_defaults',
  'runtime_heartbeats',
  'scheduled_work_item_trigger_invocations',
  'scheduled_work_item_triggers',
  'task_handoffs',
  'tasks',
  'task_tool_results',
  'tool_tags',
  'user_identities',
  'users',
  'webhook_deliveries',
  'webhook_work_item_trigger_invocations',
  'webhook_work_item_triggers',
  'webhooks',
  'worker_actual_state',
  'worker_desired_state',
  'worker_signals',
  'workers',
  'workflow_activations',
  'workflow_artifacts',
  'workflow_documents',
  'workflow_stage_gates',
  'workflow_stages',
  'workflow_tool_results',
  'workflow_work_items',
  'workflows',
] as const;

interface ResetDependencies {
  seedDefaultTenant: typeof seedDefaultTenant;
  seedConfigTables: typeof seedConfigTables;
}

export class PlaybookRedesignResetService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly deps: ResetDependencies = { seedDefaultTenant, seedConfigTables },
  ) {}

  async reset(source: NodeJS.ProcessEnv = process.env): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await deleteNonDefaultAdminKeys(client);
      await truncateResetTables(client);
      await this.deps.seedDefaultTenant(client as never, source);
      const adminEmail = source.AGIRUNNER_ADMIN_EMAIL;
      const config = adminEmail
        ? { AGIRUNNER_ADMIN_EMAIL: adminEmail }
        : undefined;
      await this.deps.seedConfigTables(client as never, config);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function truncateResetTables(client: DatabaseClient): Promise<void> {
  await client.query(
    `TRUNCATE TABLE ${PLAYBOOK_REDESIGN_RESET_TABLES.map((table) => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function deleteNonDefaultAdminKeys(client: DatabaseClient): Promise<void> {
  await client.query(
    `DELETE FROM api_keys
      WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
        AND key_prefix <> $1`,
    [DEFAULT_ADMIN_KEY_PREFIX],
  );
}
