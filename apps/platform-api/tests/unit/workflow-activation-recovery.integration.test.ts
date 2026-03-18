import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../src/jobs/lifecycle-monitor.js';
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
import { ModelCatalogService } from '../../src/services/model-catalog-service.js';
import { RuntimeDefaultsService } from '../../src/services/runtime-defaults-service.js';

describe('workflow activation recovery integration', () => {
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
      ['platform.workflow_activation_heartbeat_interval_ms', '900000'],
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
      name: 'workflow-activation-recovery-provider',
      baseUrl: 'https://example.com',
      metadata: {
        providerType: 'openai',
      },
    });
    const model = await modelCatalogService.createModel(identity.tenantId, {
      providerId: provider.id,
      modelId: 'workflow-activation-recovery-model',
    });
    await modelCatalogService.setSystemDefault(identity.tenantId, model.id, null);
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Handles workflow activation recovery integration tests.',
      systemPrompt: 'You are a developer.',
      allowedTools: [],
      capabilities: ['coding'],
      isActive: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('requeues and redispatches an orphaned activation batch through the real services', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Continuous Recovery Proof',
      outcome: 'Recover stale orchestrator activations safely',
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
      name: 'activation-recovery-worker',
      runtime_type: 'external',
      connection_mode: 'polling',
      capabilities: ['coding'],
      agents: [
        {
          name: 'workflow-orchestrator-recovery-a',
          execution_mode: 'orchestrator',
          capabilities: ['coding', 'orchestrator'],
        },
        {
          name: 'workflow-orchestrator-recovery-b',
          execution_mode: 'orchestrator',
          capabilities: ['coding', 'orchestrator'],
        },
      ],
    });
    const orchestratorAgentA = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-recovery-a');
    const orchestratorAgentB = registration.agents.find((agent) => agent.name === 'workflow-orchestrator-recovery-b');
    expect(orchestratorAgentA).toBeDefined();
    expect(orchestratorAgentB).toBeDefined();

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Activation Recovery Run',
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentA?.id)), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(firstClaim?.is_orchestrator_task).toBe(true);
    expect(firstClaim?.activation_id).toBeTruthy();

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgentA?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgentA?.id),
      worker_id: registration.worker_id,
    });

    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-recovery-proof-1',
      title: 'Recover the orphaned activation',
      goal: 'Prove stale activation recovery redispatches queued work',
    });
    expect(workItem.stage_name).toBe('triage');

    await db.pool.query(
      `UPDATE tasks
          SET state = 'failed',
              completed_at = now(),
              assigned_agent_id = NULL,
              assigned_worker_id = NULL,
              claimed_at = NULL
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(firstClaim?.id)],
    );
    await db.pool.query(
      `UPDATE workflow_activations
          SET started_at = now() - interval '10 minutes'
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [identity.tenantId, String(workflow.id), String(firstClaim?.activation_id)],
    );

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const recoveredClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentB?.id)), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const recoveredContext = (recoveredClaim?.context ?? {}) as Record<string, any>;
    expect(recoveredClaim?.is_orchestrator_task).toBe(true);
    expect(recoveredClaim?.id).not.toBe(String(firstClaim?.id));
    expect(recoveredClaim?.activation_id).toBe(String(firstClaim?.activation_id));
    expect(recoveredContext.orchestrator?.activation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'workflow.created',
        }),
        expect.objectContaining({
          event_type: 'work_item.created',
          payload: expect.objectContaining({
            work_item_id: String(workItem.id),
            stage_name: 'triage',
          }),
        }),
      ]),
    );

    const activationsAfterRecovery = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activationsAfterRecovery).toHaveLength(1);
    expect(activationsAfterRecovery[0]).toEqual(
      expect.objectContaining({
        activation_id: String(firstClaim?.activation_id),
        state: 'processing',
        activation_reason: 'queued_events',
        recovery_status: 'redispatched',
        recovery_reason: 'missing_orchestrator_task',
        redispatched_task_id: String(recoveredClaim?.id),
        event_count: 2,
      }),
    );
    expect(activationsAfterRecovery[0]?.event_types).toEqual(
      expect.arrayContaining(['workflow.created', 'work_item.created']),
    );

    const failedFirstTask = await harness.taskService.getTask(
      identity.tenantId,
      String(firstClaim?.id),
    ) as Record<string, unknown>;
    expect(failedFirstTask.state).toBe('failed');

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgentB?.id)), String(recoveredClaim?.id), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
    });

    const staleFinalizeClient = await db.pool.connect();
    try {
      await staleFinalizeClient.query('BEGIN');
      await harness.workflowActivationDispatchService.finalizeActivationForTask(
        identity.tenantId,
        {
          ...failedFirstTask,
          output: {
            summary: 'Late stale completion',
          },
        },
        'completed',
        staleFinalizeClient,
      );
      await staleFinalizeClient.query('COMMIT');
    } catch (error) {
      await staleFinalizeClient.query('ROLLBACK');
      throw error;
    } finally {
      staleFinalizeClient.release();
    }

    const activationsAfterLateCallback = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activationsAfterLateCallback).toHaveLength(1);
    expect(activationsAfterLateCallback[0]).toEqual(
      expect.objectContaining({
        activation_id: String(firstClaim?.activation_id),
        state: 'processing',
        recovery_status: 'redispatched',
        redispatched_task_id: String(recoveredClaim?.id),
      }),
    );

    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgentB?.id)), String(recoveredClaim?.id), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Recovered activation processed',
      },
    });

    const noFollowOnClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgentB?.id)), {
      agent_id: String(orchestratorAgentB?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(noFollowOnClaim).toBeNull();
  }, 120_000);
});
