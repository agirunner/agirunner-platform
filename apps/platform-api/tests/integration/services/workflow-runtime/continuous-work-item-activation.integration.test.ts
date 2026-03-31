import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../../../src/jobs/lifecycle-monitor.js';
import {
  TEST_IDENTITY as identity,
  agentIdentity,
  createV2Harness,
} from './v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../db/postgres.js';
import { ModelCatalogService } from '../../../../src/services/model-catalog-service.js';
import { RuntimeDefaultsService } from '../../../../src/services/runtime-defaults-service.js';

describe('continuous workflow work-item activation integration', () => {
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
      ['agent.max_iterations', '10'],
      ['agent.llm_max_retries', '5'],
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
    const modelCatalogService = new ModelCatalogService(db.pool);
    const provider = await modelCatalogService.createProvider(identity.tenantId, {
      name: 'continuous-work-item-provider',
      baseUrl: 'https://example.com',
      isEnabled: true,
      metadata: {
        providerType: 'openai',
      },
    });
    const model = await modelCatalogService.createModel(identity.tenantId, {
      providerId: provider.id,
      modelId: 'continuous-work-item-model',
      supportsToolUse: true,
      supportsVision: false,
      isEnabled: true,
      reasoningConfig: null,
    });
    await modelCatalogService.setSystemDefault(identity.tenantId, model.id, null);
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Handles continuous-workflow specialist tasks in integration tests.',
      systemPrompt: 'You are a developer.',
      allowedTools: [],
      isActive: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('queues manual work-item activations behind an active orchestrator and dispatches them after completion', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Continuous Intake',
      outcome: 'Process incoming work safely',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        orchestrator: {
          max_active_tasks: 2,
          max_active_tasks_per_work_item: 1,
          allow_parallel_work_items: true,
        },
        board: {
          columns: [
            { id: 'triage', label: 'Triage' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'triage', goal: 'Review inbound work' }],
      },
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'activation-serial-worker',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['coding'],
      agents: [
        {
          name: 'workflow-orchestrator-a',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
        {
          name: 'workflow-orchestrator-b',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
      ],
    });
    const orchestratorAgentA = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-a');
    const orchestratorAgentB = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-b');
    expect(orchestratorAgentA).toBeDefined();
    expect(orchestratorAgentB).toBeDefined();

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Serial Activation Run',
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentA?.id)), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(firstClaim?.is_orchestrator_task).toBe(true);

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgentA?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
    });

    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-manual-1',
      title: 'Investigate failed checkout',
      goal: 'Triage the new checkout issue',
    });
    expect(workItem.stage_name).toBe('triage');

    const activationsWhileBusy = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activationsWhileBusy.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
    ]);
    expect(activationsWhileBusy.map((activation) => activation.state)).toEqual([
      'processing',
      'queued',
    ]);

    const duplicateClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentB?.id)), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(duplicateClaim).toBeNull();

    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgentA?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Reviewed current workflow state',
      },
    });

    const secondClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentB?.id)), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const secondContext = (secondClaim?.context ?? {}) as Record<string, any>;
    expect(secondClaim?.is_orchestrator_task).toBe(true);
    expect(secondClaim?.activation_id).toBeTruthy();
    expect(secondContext.orchestrator?.activation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'work_item.created',
          payload: expect.objectContaining({
            work_item_id: String(workItem.id),
            stage_name: 'triage',
          }),
        }),
      ]),
    );

    const activationsAfterCompletion = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activationsAfterCompletion).toHaveLength(2);
    expect(activationsAfterCompletion.map((activation) => activation.state)).toEqual([
      'completed',
      'processing',
    ]);
  }, 120_000);

  it('ignores a stale duplicate completion callback once the follow-on activation is already processing', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Continuous Replay Guard',
      outcome: 'Avoid duplicate activation finalization',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        board: {
          columns: [
            { id: 'triage', label: 'Triage' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'triage', goal: 'Review inbound work' }],
      },
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'activation-replay-worker',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['coding'],
      agents: [
        {
          name: 'workflow-orchestrator-replay-a',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
        {
          name: 'workflow-orchestrator-replay-b',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
      ],
    });
    const orchestratorAgentA = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-replay-a');
    const orchestratorAgentB = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-replay-b');
    expect(orchestratorAgentA).toBeDefined();
    expect(orchestratorAgentB).toBeDefined();

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Replay Guard Run',
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentA?.id)), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(firstClaim?.is_orchestrator_task).toBe(true);

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgentA?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
    });

    await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-replay-1',
      title: 'Investigate replay issue',
      goal: 'Triage the new replay issue',
    });

    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgentA?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Reviewed current workflow state',
      },
    });

    const secondClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentB?.id)), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(secondClaim?.is_orchestrator_task).toBe(true);
    expect(secondClaim?.activation_id).toBeTruthy();

    const firstTask = await harness.taskService.getTask(identity.tenantId, String(firstClaim?.id)) as Record<string, unknown>;
    const duplicateFinalizeClient = await db.pool.connect();
    try {
      await duplicateFinalizeClient.query('BEGIN');
      await harness.workflowActivationDispatchService.finalizeActivationForTask(
        identity.tenantId,
        firstTask,
        'completed',
        duplicateFinalizeClient,
      );
      await duplicateFinalizeClient.query('COMMIT');
    } catch (error) {
      await duplicateFinalizeClient.query('ROLLBACK');
      throw error;
    } finally {
      duplicateFinalizeClient.release();
    }

    const activationsAfterReplay = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activationsAfterReplay).toHaveLength(2);
    expect(activationsAfterReplay.map((activation) => activation.state)).toEqual([
      'completed',
      'processing',
    ]);

    const thirdClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentA?.id)), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(thirdClaim).toBeNull();
  }, 120_000);
});
