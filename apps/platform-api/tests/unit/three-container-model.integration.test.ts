import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FleetService } from '../../src/services/fleet-service.js';
import { ModelCatalogService } from '../../src/services/model-catalog-service.js';
import { RuntimeDefaultsService } from '../../src/services/runtime-defaults-service.js';
import {
  TEST_IDENTITY as identity,
  agentIdentity,
  createV2Harness,
} from '../helpers/v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

describe('three-container model integration', () => {
  let db: TestDatabase;
  let harness: ReturnType<typeof createV2Harness>;
  let canRunIntegration = true;

  beforeAll(async () => {
    if (!isContainerRuntimeAvailable()) {
      canRunIntegration = false;
      return;
    }
    try {
      db = await startTestDatabase();
    } catch {
      canRunIntegration = false;
      return;
    }

    harness = createV2Harness(db, { WORKFLOW_ACTIVATION_DELAY_MS: 0 });

    const runtimeDefaultsService = new RuntimeDefaultsService(db.pool);
    for (const [configKey, configValue] of [
      ['tasks.default_timeout_minutes', '30'],
      ['agent.max_iterations', '12'],
      ['agent.llm_max_retries', '5'],
      ['global_max_runtimes', '3'],
      ['global_max_execution_containers', '1'],
      ['container_manager.hung_runtime_stale_after_seconds', '90'],
      ['specialist_runtime_bootstrap_claim_timeout_seconds', '60'],
      ['specialist_runtime_drain_grace_seconds', '15'],
      ['platform.workflow_activation_delay_ms', '10000'],
      ['platform.workflow_activation_heartbeat_interval_ms', '1800000'],
      ['platform.workflow_activation_stale_after_ms', '300000'],
      ['platform.task_cancel_signal_grace_period_ms', '60000'],
      ['platform.worker_dispatch_ack_timeout_ms', '15000'],
      ['platform.worker_default_heartbeat_interval_seconds', '30'],
      ['platform.worker_offline_grace_period_ms', '300000'],
      ['platform.worker_offline_threshold_multiplier', '2'],
      ['platform.worker_degraded_threshold_multiplier', '1'],
      ['platform.worker_key_expiry_ms', '60000'],
      ['platform.agent_default_heartbeat_interval_seconds', '30'],
      ['platform.agent_heartbeat_grace_period_ms', '300000'],
      ['platform.agent_heartbeat_threshold_multiplier', '2'],
      ['platform.agent_key_expiry_ms', '60000'],
    ] as const) {
      await runtimeDefaultsService.createDefault(identity.tenantId, {
        configKey,
        configValue,
        configType: 'number',
      });
    }

    for (const [configKey, configValue] of [
      ['specialist_runtime_default_image', 'agirunner-runtime:local'],
      ['specialist_runtime_default_cpu', '1'],
      ['specialist_runtime_default_memory', '512Mi'],
      ['specialist_runtime_default_pull_policy', 'if-not-present'],
      ['specialist_execution_default_image', 'agirunner-runtime-execution:local'],
      ['specialist_execution_default_cpu', '1'],
      ['specialist_execution_default_memory', '1Gi'],
      ['specialist_execution_default_pull_policy', 'if-not-present'],
    ] as const) {
      await runtimeDefaultsService.createDefault(identity.tenantId, {
        configKey,
        configValue,
        configType: 'string',
      });
    }

    const modelCatalogService = new ModelCatalogService(db.pool);
    const provider = await modelCatalogService.createProvider(identity.tenantId, {
      name: 'three-container-provider',
      baseUrl: 'https://example.com',
      isEnabled: true,
      metadata: {
        providerType: 'openai',
      },
    });
    const model = await modelCatalogService.createModel(identity.tenantId, {
      providerId: provider.id,
      modelId: 'three-container-model',
      supportsToolUse: true,
      supportsVision: false,
      isEnabled: true,
      reasoningConfig: null,
    });
    await modelCatalogService.setSystemDefault(identity.tenantId, model.id, null);
  }, 120_000);

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('resolves specialist execution defaults, merges role overrides, and backpressures claims at the execution cap', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'default-specialist',
      description: 'Uses the tenant execution defaults',
      allowedTools: [],
      maxEscalationDepth: 3,
    });
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'heavy-specialist',
      description: 'Overrides the execution container contract',
      allowedTools: [],
      maxEscalationDepth: 3,
      executionContainerConfig: {
        image: 'agirunner-runtime-execution-override:local',
        memory: '3Gi',
      },
    });

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Three Container Validation',
      outcome: 'Validate runtime and execution container defaults',
      definition: {
        roles: ['default-specialist', 'heavy-specialist'],
        lifecycle: 'ongoing',
        board: {
          columns: [
            { id: 'queued', label: 'Queued' },
            { id: 'doing', label: 'Doing' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Run specialist tasks' }],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Three Container Flow',
    });
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-three-container-1',
      title: 'Validate specialist execution contract',
      goal: 'Run specialists under the new three-container model',
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'three-container-worker',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
      agents: [
        {
          name: 'specialist-a',
          execution_mode: 'specialist',
          routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        },
        {
          name: 'specialist-b',
          execution_mode: 'specialist',
          routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        },
      ],
    });
    const firstAgent = registration.agents.find((agent) => agent.name === 'specialist-a');
    const secondAgent = registration.agents.find((agent) => agent.name === 'specialist-b');
    expect(firstAgent).toBeDefined();
    expect(secondAgent).toBeDefined();

    const defaultTask = await harness.taskService.createTask(identity, {
      title: 'Default specialist execution',
      role: 'default-specialist',
      work_item_id: String(workItem.id),
      request_id: 'tc-default-1',
      input: { description: 'Run with tenant execution defaults' },
    });
    const overrideTask = await harness.taskService.createTask(identity, {
      title: 'Override specialist execution',
      role: 'heavy-specialist',
      work_item_id: String(workItem.id),
      request_id: 'tc-override-1',
      input: { description: 'Run with role execution override' },
    });

    const fleetService = new FleetService(db.pool as never);
    const pendingTargets = await fleetService.getRuntimeTargets(identity.tenantId);
    expect(pendingTargets).toHaveLength(1);
    expect(pendingTargets[0]).toMatchObject({
      playbook_id: 'specialist',
      pool_kind: 'specialist',
      pool_mode: 'cold',
      max_runtimes: 3,
      image: 'agirunner-runtime:local',
      cpu: '1',
      memory: '512Mi',
      pull_policy: 'if-not-present',
      pending_tasks: 2,
      active_execution_containers: 0,
      available_execution_slots: 1,
    });

    const firstClaim = await harness.taskService.claimTask(
      agentIdentity(String(firstAgent?.id)),
      {
        agent_id: String(firstAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        playbook_id: String(playbook.id),
      },
    );

    expect(firstClaim?.id).toBe(defaultTask.id);
    expect((firstClaim as Record<string, any>).execution_container).toEqual({
      image: 'agirunner-runtime-execution:local',
      cpu: '1',
      memory: '1Gi',
      pull_policy: 'if-not-present',
    });

    const heldTargets = await fleetService.getRuntimeTargets(identity.tenantId);
    expect(heldTargets).toHaveLength(1);
    expect(heldTargets[0]).toMatchObject({
      pending_tasks: 1,
      active_execution_containers: 1,
      available_execution_slots: 0,
    });

    const blockedClaim = await harness.taskService.claimTask(
      agentIdentity(String(secondAgent?.id)),
      {
        agent_id: String(secondAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        playbook_id: String(playbook.id),
      },
    );

    expect(blockedClaim).toBeNull();
    const stillReadyTask = await harness.taskService.getTask(identity.tenantId, String(overrideTask.id));
    expect(stillReadyTask.state).toBe('ready');

    await harness.taskService.startTask(
      agentIdentity(String(firstAgent?.id)),
      String(defaultTask.id),
      {
        agent_id: String(firstAgent?.id),
        worker_id: registration.worker_id,
      },
    );
    await harness.taskService.completeTask(
      agentIdentity(String(firstAgent?.id)),
      String(defaultTask.id),
      {
        agent_id: String(firstAgent?.id),
        worker_id: registration.worker_id,
        output: { summary: 'default execution verified' },
      },
    );

    const releasedTargets = await fleetService.getRuntimeTargets(identity.tenantId);
    expect(releasedTargets).toHaveLength(1);
    expect(releasedTargets[0]).toMatchObject({
      pending_tasks: 1,
      active_execution_containers: 0,
      available_execution_slots: 1,
    });

    const secondClaim = await harness.taskService.claimTask(
      agentIdentity(String(secondAgent?.id)),
      {
        agent_id: String(secondAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        playbook_id: String(playbook.id),
      },
    );

    expect(secondClaim?.id).toBe(overrideTask.id);
    expect((secondClaim as Record<string, any>).execution_container).toEqual({
      image: 'agirunner-runtime-execution-override:local',
      cpu: '1',
      memory: '3Gi',
      pull_policy: 'if-not-present',
    });

    await harness.taskService.startTask(
      agentIdentity(String(secondAgent?.id)),
      String(overrideTask.id),
      {
        agent_id: String(secondAgent?.id),
        worker_id: registration.worker_id,
      },
    );
    await harness.taskService.completeTask(
      agentIdentity(String(secondAgent?.id)),
      String(overrideTask.id),
      {
        agent_id: String(secondAgent?.id),
        worker_id: registration.worker_id,
        output: { summary: 'override execution verified' },
      },
    );

    const runtimeDefaultsService = new RuntimeDefaultsService(db.pool);
    const imageDefault = await runtimeDefaultsService.getByKey(
      identity.tenantId,
      'specialist_execution_default_image',
    );
    const memoryDefault = await runtimeDefaultsService.getByKey(
      identity.tenantId,
      'specialist_execution_default_memory',
    );
    expect(imageDefault?.id).toBeDefined();
    expect(memoryDefault?.id).toBeDefined();

    await runtimeDefaultsService.updateDefault(identity.tenantId, String(imageDefault?.id), {
      configValue: 'agirunner-runtime-execution:new-default',
      configType: 'string',
    });
    await runtimeDefaultsService.updateDefault(identity.tenantId, String(memoryDefault?.id), {
      configValue: '2Gi',
      configType: 'string',
    });

    const updatedDefaultTask = await harness.taskService.createTask(identity, {
      title: 'Updated tenant execution defaults',
      role: 'default-specialist',
      work_item_id: String(workItem.id),
      request_id: 'tc-default-2',
      input: { description: 'Run with updated tenant execution defaults' },
    });

    const updatedClaim = await harness.taskService.claimTask(
      agentIdentity(String(firstAgent?.id)),
      {
        agent_id: String(firstAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['role:default-specialist', 'role:heavy-specialist'],
        playbook_id: String(playbook.id),
      },
    );

    expect(updatedClaim?.id).toBe(updatedDefaultTask.id);
    expect((updatedClaim as Record<string, any>).execution_container).toEqual({
      image: 'agirunner-runtime-execution:new-default',
      cpu: '1',
      memory: '2Gi',
      pull_policy: 'if-not-present',
    });
  }, 120_000);
});
