import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../../../src/jobs/lifecycle-monitor.js';
import { HandoffService } from '../../../../src/services/handoff-service/handoff-service.js';
import { ModelCatalogService } from '../../../../src/services/model-catalog/model-catalog-service.js';
import { RuntimeDefaultsService } from '../../../../src/services/runtime-defaults/runtime-defaults-service.js';
import { WorkflowOperatorBriefService } from '../../../../src/services/workflow-operator/workflow-operator-brief-service.js';
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

const VERIFIED_BASELINE_COMMANDS = [
  'sleep',
  'sh',
  'cat',
  'mkdir',
  'mv',
  'chmod',
  'rm',
  'cp',
  'find',
  'sort',
  'awk',
  'sed',
  'grep',
  'head',
] as const;

describe('V2 escalation round-trip integration', () => {
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
      ['global_max_specialists', '20'],
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
    ] as const) {
      await runtimeDefaultsService.createDefault(identity.tenantId, {
        configKey,
        configValue,
        configType: 'string',
      });
    }
    await db.pool.query(
      `INSERT INTO execution_environments (
         tenant_id,
         slug,
         name,
         description,
         source_kind,
         catalog_key,
         catalog_version,
         image,
         cpu,
         memory,
         pull_policy,
         bootstrap_commands,
         bootstrap_required_domains,
         declared_metadata,
         verified_metadata,
         tool_capabilities,
         compatibility_status,
         compatibility_errors,
         verification_contract_version,
         last_verified_at,
         is_default,
         is_archived,
         is_claimable
       ) VALUES (
         $1, 'default-specialist-env', 'Default Specialist Environment', 'Default execution environment',
         'custom', NULL, NULL, 'debian:trixie-slim', '1', '1Gi', 'if-not-present',
         '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
         '{"distro":"debian","package_manager":"apt-get"}'::jsonb,
         $2::jsonb,
         'compatible', '[]'::jsonb, 'v1', now(), true, false, true
       )`,
      [
        identity.tenantId,
        JSON.stringify({
          verified_baseline_commands: VERIFIED_BASELINE_COMMANDS,
          git_present: true,
          docker_cli_present: false,
          shell_glob: true,
          shell_pipe: true,
          shell_redirect: true,
        }),
      ],
    );
    const modelCatalogService = new ModelCatalogService(db.pool);
    const provider = await modelCatalogService.createProvider(identity.tenantId, {
      name: 'escalation-flow-provider',
      baseUrl: 'https://example.com',
      isEnabled: true,
      metadata: {
        providerType: 'openai',
      },
    });
    const model = await modelCatalogService.createModel(identity.tenantId, {
      providerId: provider.id,
      modelId: 'escalation-flow-model',
      contextWindow: 128000,
      maxOutputTokens: 4096,
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

  it('routes specialist escalation through orchestrator activation and human resolution before resuming execution', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Escalation-capable developer specialist',
      escalationTarget: 'human',
      maxEscalationDepth: 3,
    });

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Escalation Flow',
      outcome: 'Specialist resumes after operator guidance',
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
            { id: 'implementation', label: 'Implementation' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Deliver the requested change' }],
      },
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'runtime-escalation-harness',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['coding', 'role:developer'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
        {
          name: 'developer-specialist',
          execution_mode: 'specialist',
          routing_tags: ['coding', 'testing', 'role:developer'],
        },
      ],
    });
    const orchestratorAgent = registration.agents.find((agent) => agent.name === 'workflow-orchestrator');
    const specialistAgent = registration.agents.find((agent) => agent.name === 'developer-specialist');
    expect(orchestratorAgent).toBeDefined();
    expect(specialistAgent).toBeDefined();

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Escalation Run',
    });
    const handoffService = new HandoffService(db.pool);
    const workflowOperatorBriefService = new WorkflowOperatorBriefService(db.pool);
    const recordOrchestratorBrief = async (taskId: string, activationId: string, headline: string) => {
      await workflowOperatorBriefService.recordBrief(identity, String(workflow.id), {
        requestId: `operator-brief:${activationId}:${taskId}`,
        executionContextId: activationId,
        sourceKind: 'orchestrator',
        sourceRoleName: 'Orchestrator',
        briefKind: 'milestone',
        payload: {
          shortBrief: {
            headline,
          },
          detailedBriefJson: {
            headline,
            status_kind: 'completed',
            summary: headline,
          },
        },
      });
    };
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-escalation-1',
      title: 'Handle edge-case policy branch',
      goal: 'Finish implementation with operator guidance if blocked',
    });
    const specialistTask = await harness.taskService.createTask(identity, {
      title: 'Implement policy edge case',
      role: 'developer',
      work_item_id: String(workItem.id),
      request_id: 'specialist-escalation-1',
      input: { description: 'Implement the policy branch and escalate if guidance is required' },
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const initialOrchestratorClaim = await harness.taskService.claimTask(
      agentIdentity(String(orchestratorAgent?.id)),
      {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['coding', 'orchestrator'],
        include_context: true,
        playbook_id: String(playbook.id),
      },
    );
    const initialActivation = ((initialOrchestratorClaim?.context ?? {}) as Record<string, any>).orchestrator?.activation;
    expect(initialOrchestratorClaim?.is_orchestrator_task).toBe(true);
    expect(initialActivation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'workflow.created' }),
      ]),
    );

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(initialOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(initialOrchestratorClaim?.id), {
      request_id: 'escalation-orchestrator-handoff-1',
      summary: 'Queued specialist work for implementation.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(initialOrchestratorClaim?.id),
      String(initialOrchestratorClaim?.activation_id),
      'Queued specialist work for implementation.',
    );
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(initialOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Queued specialist work for implementation',
      },
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const workItemOrchestratorClaim = await harness.taskService.claimTask(
      agentIdentity(String(orchestratorAgent?.id)),
      {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['coding', 'orchestrator'],
        include_context: true,
        playbook_id: String(playbook.id),
      },
    );
    const workItemActivation = ((workItemOrchestratorClaim?.context ?? {}) as Record<string, any>).orchestrator?.activation;
    expect(workItemOrchestratorClaim?.is_orchestrator_task).toBe(true);
    expect(workItemActivation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'work_item.created',
          payload: expect.objectContaining({
            work_item_id: String(workItem.id),
            stage_name: 'implementation',
          }),
        }),
      ]),
    );

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(workItemOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(workItemOrchestratorClaim?.id), {
      request_id: 'escalation-orchestrator-handoff-2',
      summary: 'Registered the queued work item for specialist execution.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(workItemOrchestratorClaim?.id),
      String(workItemOrchestratorClaim?.activation_id),
      'Registered the queued work item for specialist execution.',
    );
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(workItemOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Registered the queued work item for specialist execution',
      },
    });

    const specialistClaim = await harness.taskService.claimTask(agentIdentity(String(specialistAgent?.id)), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'testing', 'role:developer'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(specialistClaim?.id).toBe(specialistTask.id);

    await harness.taskService.startTask(agentIdentity(String(specialistAgent?.id)), String(specialistTask.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
    });

    const escalatedTask = await harness.taskService.agentEscalate(
      agentIdentity(String(specialistAgent?.id)),
      String(specialistTask.id),
      {
        reason: 'Need operator guidance on the fallback policy',
        context_summary: 'The normal branch is complete but the fallback decision is ambiguous.',
        work_so_far: 'Implemented API scaffolding and validation checks.',
      },
    );
    expect(escalatedTask.state).toBe('escalated');

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const escalationOrchestratorClaim = await harness.taskService.claimTask(
      agentIdentity(String(orchestratorAgent?.id)),
      {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['coding', 'orchestrator'],
        include_context: true,
        playbook_id: String(playbook.id),
      },
    );
    const escalationActivation = ((escalationOrchestratorClaim?.context ?? {}) as Record<string, any>).orchestrator?.activation;
    expect(escalationOrchestratorClaim?.is_orchestrator_task).toBe(true);
    expect(escalationActivation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'task.agent_escalated',
          payload: expect.objectContaining({
            task_id: String(specialistTask.id),
            work_item_id: String(workItem.id),
            stage_name: 'implementation',
            escalation_target: 'human',
          }),
        }),
      ]),
    );

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(escalationOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(escalationOrchestratorClaim?.id), {
      request_id: 'escalation-orchestrator-handoff-3',
      summary: 'Escalation noted and awaiting operator response.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(escalationOrchestratorClaim?.id),
      String(escalationOrchestratorClaim?.activation_id),
      'Escalation noted and awaiting operator response.',
    );
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(escalationOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Escalation noted and awaiting operator response',
      },
    });

    const resolvedTask = await harness.taskService.resolveEscalation(identity, String(specialistTask.id), {
      instructions: 'Use the fallback policy branch and record the exception in the final output.',
      context: {
        policy_decision: 'fallback-approved',
      },
    });
    expect(resolvedTask.state).toBe('ready');
    expect((resolvedTask.input as Record<string, any>).escalation_resolution).toEqual(
      expect.objectContaining({
        resolved_by: 'human',
        instructions: 'Use the fallback policy branch and record the exception in the final output.',
        context: {
          policy_decision: 'fallback-approved',
        },
      }),
    );

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const resolutionOrchestratorClaim = await harness.taskService.claimTask(
      agentIdentity(String(orchestratorAgent?.id)),
      {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['coding', 'orchestrator'],
        include_context: true,
        playbook_id: String(playbook.id),
      },
    );
    const resolutionActivation = ((resolutionOrchestratorClaim?.context ?? {}) as Record<string, any>).orchestrator?.activation;
    expect(resolutionOrchestratorClaim?.is_orchestrator_task).toBe(true);
    expect(resolutionActivation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'task.escalation_resolved',
          payload: expect.objectContaining({
            task_id: String(specialistTask.id),
            work_item_id: String(workItem.id),
            stage_name: 'implementation',
            resolved_by: 'human',
          }),
        }),
      ]),
    );

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(resolutionOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(resolutionOrchestratorClaim?.id), {
      request_id: 'escalation-orchestrator-handoff-4',
      summary: 'Operator guidance merged back into the work queue.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(resolutionOrchestratorClaim?.id),
      String(resolutionOrchestratorClaim?.activation_id),
      'Operator guidance merged back into the work queue.',
    );
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(resolutionOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Operator guidance merged back into the work queue',
      },
    });

    const resumedSpecialistClaim = await harness.taskService.claimTask(
      agentIdentity(String(specialistAgent?.id)),
      {
        agent_id: String(specialistAgent?.id),
        worker_id: registration.worker_id,
        routing_tags: ['coding', 'testing', 'role:developer'],
        include_context: true,
        playbook_id: String(playbook.id),
      },
    );
    expect(resumedSpecialistClaim?.id).toBe(specialistTask.id);
    expect(resumedSpecialistClaim?.state).toBe('claimed');

    const resumedTask = await harness.taskService.getTask(identity.tenantId, String(specialistTask.id));
    const resumedTaskInput = ((resumedTask as unknown as Record<string, unknown>).input ?? {}) as Record<string, any>;
    expect(resumedTaskInput.escalation_resolution).toEqual(
      expect.objectContaining({
        resolved_by: 'human',
        instructions: 'Use the fallback policy branch and record the exception in the final output.',
      }),
    );

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
      'task.agent_escalated',
      'task.escalation_resolved',
    ]);
    expect(activations.map((activation) => activation.state)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  }, 120_000);
});
