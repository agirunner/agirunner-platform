import { randomUUID } from 'node:crypto';

import { vi } from 'vitest';

import { seedConfigTables } from '../../../src/bootstrap/seed.js';
import { ApprovalQueueService } from '../../../src/services/approval-queue-service.js';
import { RoleDefinitionService } from '../../../src/services/role-definition-service.js';
import { WorkflowChainingService } from '../../../src/services/workflow-chaining-service.js';
import {
  TEST_IDENTITY as identity,
  createV2Harness,
} from '../helpers/v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown; headers: Record<string, unknown> }) => {
    const rawOwnerId = request.headers['x-test-owner-id'];
    const ownerId = Array.isArray(rawOwnerId) ? rawOwnerId[0] : rawOwnerId;
    request.auth = {
      id: ownerId ? `agent-key:${ownerId}` : 'test-agent-key',
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: typeof ownerId === 'string' ? ownerId : null,
      keyPrefix: typeof ownerId === 'string' ? `agent-${ownerId}` : 'test-agent',
    };
  },
  withScope: () => async () => {},
}));

export interface PlaybookWorkflowIntegrationSuite {
  db?: TestDatabase;
  harness?: ReturnType<typeof createV2Harness>;
  workflowChainingService?: WorkflowChainingService;
  approvalQueueService?: ApprovalQueueService;
  canRunIntegration: boolean;
  cleanup: () => Promise<void>;
}

export async function setupPlaybookWorkflowIntegrationSuite(): Promise<PlaybookWorkflowIntegrationSuite> {
  let db: TestDatabase | undefined;
  let harness: ReturnType<typeof createV2Harness> | undefined;
  let workflowChainingService: WorkflowChainingService | undefined;
  let approvalQueueService: ApprovalQueueService | undefined;
  let canRunIntegration = true;

  if (!isContainerRuntimeAvailable()) {
    canRunIntegration = false;
    return {
      canRunIntegration,
      cleanup: async () => {},
    };
  }

  try {
    db = await startTestDatabase();
  } catch {
    canRunIntegration = false;
    return {
      canRunIntegration,
      cleanup: async () => {},
    };
  }

  harness = createV2Harness(db, { WORKFLOW_ACTIVATION_DELAY_MS: 0 });
  workflowChainingService = new WorkflowChainingService(db.pool, harness.workflowService);
  approvalQueueService = new ApprovalQueueService(db.pool);

  const providerId = randomUUID();
  const modelId = randomUUID();
  await db.pool.query(
    `INSERT INTO llm_providers
      (id, tenant_id, name, base_url, api_key_secret_ref, is_enabled, metadata, auth_mode)
     VALUES
      ($1, $2, 'OpenAI', 'https://api.openai.com/v1', 'secret://openai', true, $3::jsonb, 'api_key')`,
    [
      providerId,
      identity.tenantId,
      JSON.stringify({
        providerType: 'openai',
      }),
    ],
  );
  await db.pool.query(
    `INSERT INTO llm_models
      (id, tenant_id, provider_id, model_id, is_enabled, endpoint_type, reasoning_config)
     VALUES
      ($1, $2, $3, 'gpt-5.4', true, 'responses', $4::jsonb)`,
    [
      modelId,
      identity.tenantId,
      providerId,
      JSON.stringify({
        type: 'reasoning_effort',
        options: ['none', 'low', 'medium', 'high', 'xhigh'],
        default: 'none',
      }),
    ],
  );
  await db.pool.query(
    `INSERT INTO runtime_defaults
      (tenant_id, config_key, config_value, config_type, description)
     VALUES
      ($1, 'default_model_id', $2, 'string', 'Configured on the LLM Providers page'),
      ($1, 'default_reasoning_config', $3::text, 'json', 'Configured on the LLM Providers page')
     ON CONFLICT (tenant_id, config_key)
     DO UPDATE SET
       config_value = EXCLUDED.config_value,
       config_type = EXCLUDED.config_type,
       description = EXCLUDED.description,
       updated_at = now()`,
    [
      identity.tenantId,
      modelId,
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-5.4',
        reasoning_effort: 'low',
      }),
    ],
  );
  await seedConfigTables(db.pool);

  const roleService = new RoleDefinitionService(db.pool);
  await roleService.createRole(identity.tenantId, {
    name: 'product-manager',
    description: 'Integration-test product manager role',
    systemPrompt: 'Clarify scope, plan the work, and submit a structured handoff.',
    allowedTools: ['submit_handoff'],
    verificationStrategy: 'peer_review',
    isActive: true,
  });
  await roleService.createRole(identity.tenantId, {
    name: 'developer',
    description: 'Integration-test developer role',
    systemPrompt: 'Implement the requested change and submit a structured handoff.',
    allowedTools: ['shell_exec', 'submit_handoff'],
    verificationStrategy: 'peer_review',
    isActive: true,
  });

  return {
    db,
    harness,
    workflowChainingService,
    approvalQueueService,
    canRunIntegration,
    cleanup: async () => {
      if (db) {
        await stopTestDatabase(db);
      }
    },
  };
}
