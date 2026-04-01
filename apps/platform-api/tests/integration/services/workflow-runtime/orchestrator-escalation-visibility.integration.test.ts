import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ModelCatalogService } from '../../../../src/services/model-catalog/model-catalog-service.js';
import { RuntimeDefaultsService } from '../../../../src/services/runtime-defaults/runtime-defaults-service.js';
import { WorkflowWorkspaceService } from '../../../../src/services/workflow-operations/workflow-workspace-service.js';
import {
  TEST_IDENTITY as identity,
  agentIdentity,
  createV2Harness,
} from './v2-harness.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../db/postgres.js';

describe('orchestrator escalation visibility integration', () => {
  let db: TestDatabase;
  let harness: ReturnType<typeof createV2Harness>;

  beforeAll(async () => {
    db = await startTestDatabase();
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
    const modelCatalogService = new ModelCatalogService(db.pool);
    const provider = await modelCatalogService.createProvider(identity.tenantId, {
      name: 'orchestrator-escalation-visibility-provider',
      baseUrl: 'https://example.com',
      isEnabled: true,
      metadata: {
        providerType: 'openai',
      },
    });
    const model = await modelCatalogService.createModel(identity.tenantId, {
      providerId: provider.id,
      modelId: 'orchestrator-escalation-visibility-model',
      supportsToolUse: true,
      supportsVision: false,
      isEnabled: true,
      reasoningConfig: null,
    });
    await modelCatalogService.setSystemDefault(identity.tenantId, model.id, null);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('surfaces a real orchestrator-task escalation in the workflow workspace needs-action packet', async () => {
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'orchestrator',
      description: 'Workflow orchestrator',
      escalationTarget: 'human',
      maxEscalationDepth: 3,
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'orchestrator-escalation-visibility-worker',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['coding', 'orchestrator'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
      ],
    });
    const orchestratorAgent = registration.agents.find((agent) => agent.name === 'workflow-orchestrator');
    expect(orchestratorAgent).toBeDefined();

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Escalation Visibility',
      outcome: 'Surface orchestrator escalation on the workflow page',
      definition: {
        roles: ['orchestrator'],
        lifecycle: 'planned',
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'review', goal: 'Review the change.' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Escalation Visibility Run',
    });

    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'work-item-1',
      stage_name: 'review',
      title: 'Review replacement patch',
      goal: 'Review the replacement patch and escalate if blocked.',
    });

    const orchestratorTask = await harness.taskService.createTask(identity, {
      workflow_id: String(workflow.id),
      work_item_id: String(workItem.id),
      title: 'Orchestrate Review replacement patch',
      role: 'orchestrator',
      stage_name: 'review',
      task_kind: 'orchestrator',
      is_orchestrator_task: true,
      metadata: {
        task_kind: 'orchestrator',
      },
    });

    await db.pool.query(
      `UPDATE tasks
          SET state = 'claimed',
              state_changed_at = now(),
              assigned_agent_id = $3,
              assigned_worker_id = $4,
              claimed_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(orchestratorTask.id), String(orchestratorAgent?.id), registration.worker_id],
    );
    await db.pool.query(
      `UPDATE agents
          SET current_task_id = $2,
              status = 'busy',
              last_heartbeat_at = now(),
              last_claim_at = now()
        WHERE tenant_id = $1
          AND id = $3`,
      [identity.tenantId, String(orchestratorTask.id), String(orchestratorAgent?.id)],
    );

    await harness.taskService.startTask(
      agentIdentity(String(orchestratorAgent?.id)),
      String(orchestratorTask.id),
      {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
      },
    );

    const escalatedTask = await harness.taskService.agentEscalate(
      agentIdentity(String(orchestratorAgent?.id)) as never,
      String(orchestratorTask.id),
      {
        reason: 'Blocked from dispatching the required reviewer task because ownership transfer failed.',
        context_summary: 'The replacement review work item exists, but the next reviewer task creation was rejected.',
        work_so_far: 'Verified the implementation handoff and recreated the review work item.',
      },
    );
    expect(escalatedTask.state).toBe('escalated');

    const workspaceService = new WorkflowWorkspaceService(
      harness.workflowService as never,
      {
        getWorkflowCard: async () => ({
          id: String(workflow.id),
          name: 'Escalation Visibility Run',
          posture: 'needs_intervention',
          pulse: { summary: 'Waiting on escalation guidance' },
          availableActions: [],
          outputDescriptors: [],
          metrics: {
            openEscalationCount: 1,
            waitingForDecisionCount: 0,
            blockedWorkItemCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            activeTaskCount: 1,
            activeWorkItemCount: 1,
            lastChangedAt: new Date().toISOString(),
          },
        }),
      } as never,
      { getLiveConsole: async () => ({ snapshot_version: 'workflow-operations:1', generated_at: new Date().toISOString(), latest_event_id: 1, items: [], next_cursor: null, live_visibility_mode: 'enhanced' }) } as never,
      { getHistory: async () => ({ snapshot_version: 'workflow-operations:1', generated_at: new Date().toISOString(), latest_event_id: 1, groups: [], items: [], filters: { available: [], active: [] }, next_cursor: null }) } as never,
      { getDeliverables: async () => ({ final_deliverables: [], in_progress_deliverables: [], working_handoffs: [], inputs_and_provenance: { launch_packet: null, supplemental_packets: [], intervention_attachments: [], redrive_packet: null }, next_cursor: null, all_deliverables: [] }) } as never,
      { listWorkflowInterventions: async () => [] } as never,
      { listSessions: async () => [], listMessages: async () => [] } as never,
      harness.taskService as never,
    );

    const workspace = await workspaceService.getWorkspace(identity.tenantId, String(workflow.id), {
      workItemId: String(workItem.id),
      tabScope: 'selected_work_item',
    });

    expect(workspace.bottom_tabs.counts.needs_action).toBeGreaterThan(0);
    expect(workspace.needs_action.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_kind: 'resolve_escalation',
          target: {
            target_kind: 'task',
            target_id: String(orchestratorTask.id),
          },
          summary: expect.stringContaining('needs escalation resolution'),
          details: expect.arrayContaining([
            expect.objectContaining({
              label: 'Context',
              value: 'The replacement review work item exists, but the next reviewer task creation was rejected.',
            }),
            expect.objectContaining({
              label: 'Work so far',
              value: 'Verified the implementation handoff and recreated the review work item.',
            }),
          ]),
        }),
      ]),
    );
  });
});
