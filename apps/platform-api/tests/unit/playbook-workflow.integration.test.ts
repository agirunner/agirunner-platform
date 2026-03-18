import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../src/jobs/lifecycle-monitor.js';
import { seedConfigTables } from '../../src/bootstrap/seed.js';
import { ApprovalQueueService } from '../../src/services/approval-queue-service.js';
import { RoleDefinitionService } from '../../src/services/role-definition-service.js';
import { ScheduledWorkItemTriggerService } from '../../src/services/scheduled-work-item-trigger-service.js';
import { WebhookWorkItemTriggerService } from '../../src/services/webhook-work-item-trigger-service.js';
import { WorkflowChainingService } from '../../src/services/workflow-chaining-service.js';
import {
  TEST_IDENTITY as identity,
  agentIdentity,
  createOrchestratorControlTestApp,
  createV2Harness,
} from '../helpers/v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

describe('playbook workflow integration', () => {
  let db: TestDatabase;
  let workflowChainingService: WorkflowChainingService;
  let approvalQueueService: ApprovalQueueService;
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
      capabilities: ['planning'],
      verificationStrategy: 'peer_review',
      isActive: true,
    });

    await roleService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Integration-test developer role',
      systemPrompt: 'Implement the requested change and submit a structured handoff.',
      allowedTools: ['shell_exec', 'submit_handoff'],
      capabilities: ['coding'],
      verificationStrategy: 'peer_review',
      isActive: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('creates a playbook workflow, work item, and idempotent linked task', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Implementation Flow',
      outcome: 'Shipped work',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        board: {
          entry_column_id: 'active',
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Code is written' }],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Flow Run',
    });
    expect(workflow.playbook_id).toBe(playbook.id);
    expect(workflow).not.toHaveProperty('current_stage');
    expect(workflow.activations).toHaveLength(1);

    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-1',
      title: 'Implement authentication',
      goal: 'Deliver auth support',
    });
    expect(workItem.workflow_id).toBe(workflow.id);
    expect(workItem.stage_name).toBe('implementation');
    expect(workItem.column_id).toBe('active');

    const loadedWorkItem = await harness.workflowService.getWorkflowWorkItem(
      identity.tenantId,
      String(workflow.id),
      String(workItem.id),
    );
    expect(loadedWorkItem.id).toBe(workItem.id);
    expect(loadedWorkItem.task_count).toBe(0);

    const firstTask = await harness.taskService.createTask(identity, {
      title: 'Developer implements auth',
      role: 'developer',
      work_item_id: String(workItem.id),
      request_id: 'task-1',
      input: { description: 'Implement authentication end to end' },
    });
    const duplicateTask = await harness.taskService.createTask(identity, {
      title: 'Developer implements auth',
      role: 'developer',
      work_item_id: String(workItem.id),
      request_id: 'task-1',
      input: { description: 'Implement authentication end to end' },
    });

    expect(firstTask.id).toBe(duplicateTask.id);
    expect(firstTask.workflow_id).toBe(workflow.id);
    expect(firstTask.work_item_id).toBe(workItem.id);
    expect(firstTask.stage_name).toBe('implementation');

    const updatedWorkItem = await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(workItem.id),
      {
        priority: 'high',
        notes: 'Implementation shipped',
      },
    );
    expect(updatedWorkItem.priority).toBe('high');
    expect(updatedWorkItem.notes).toBe('Implementation shipped');
    expect(updatedWorkItem.completed_at).toBeNull();

    const hydratedWorkflow = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    const hydratedTasks = Array.isArray(hydratedWorkflow.tasks)
      ? (hydratedWorkflow.tasks as Array<Record<string, unknown>>)
      : [];
    expect(hydratedTasks).toHaveLength(2);
    expect(hydratedTasks.filter((task) => task.is_orchestrator_task === true)).toHaveLength(1);
    expect(hydratedTasks.filter((task) => task.is_orchestrator_task !== true)).toHaveLength(1);
    expect(hydratedWorkflow.work_items).toHaveLength(1);
    const hydratedActivations = Array.isArray(hydratedWorkflow.activations)
      ? (hydratedWorkflow.activations as Array<Record<string, unknown>>)
      : [];
    expect(hydratedActivations).toHaveLength(3);
    expect(hydratedActivations.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
      'work_item.updated',
    ]);
    expect(hydratedWorkflow.active_stages).toEqual(['implementation']);

    const workflowList = await harness.workflowService.listWorkflows(identity.tenantId, {
      page: 1,
      per_page: 20,
    });
    const listedWorkflow = workflowList.data.find((entry) => entry.id === workflow.id) as
      | Record<string, unknown>
      | undefined;
    expect(listedWorkflow).toBeDefined();
    expect(listedWorkflow?.work_item_summary).toEqual({
      total_work_items: 1,
      open_work_item_count: 1,
      completed_work_item_count: 0,
      active_stage_count: 1,
      awaiting_gate_count: 0,
      active_stage_names: ['implementation'],
    });

    const childWorkflow = await workflowChainingService.chainWorkflowExplicit(
      identity,
      String(workflow.id),
      {
        playbook_id: String(playbook.id),
        name: 'Flow Follow-up',
      },
    );
    expect(childWorkflow.playbook_id).toBe(playbook.id);

    const sourceAfterChain = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    const sourceMetadata = (sourceAfterChain.metadata ?? {}) as Record<string, unknown>;
    expect(sourceMetadata.latest_child_workflow_id).toBe(childWorkflow.id);
    expect(sourceMetadata.child_workflow_ids).toContain(childWorkflow.id);

  }, 120_000);

  it('preserves deterministic work-item event history and activation flow across board moves and reparenting', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Board Move Flow',
      outcome: 'Track board moves cleanly',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        board: {
          columns: [
            { id: 'backlog', label: 'Backlog' },
            { id: 'implementing', label: 'Implementing' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'triage', goal: 'Sort incoming work' },
          { name: 'implementation', goal: 'Execute the work' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Board Move Run',
    });

    const parentA = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'parent-a',
      title: 'Parent A',
      stage_name: 'triage',
      column_id: 'backlog',
    });
    const parentB = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'parent-b',
      title: 'Parent B',
      stage_name: 'implementation',
      column_id: 'implementing',
    });
    const child = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'child-1',
      title: 'Child Item',
      parent_work_item_id: String(parentA.id),
      stage_name: 'triage',
      column_id: 'backlog',
    });

    await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(child.id),
      {
        stage_name: 'implementation',
        column_id: 'implementing',
      },
    );
    const finalChild = await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(child.id),
      {
        parent_work_item_id: String(parentB.id),
        column_id: 'done',
      },
    );

    expect(finalChild).toEqual(
      expect.objectContaining({
        parent_work_item_id: parentB.id,
        stage_name: 'implementation',
        column_id: 'done',
      }),
    );

    const events = await harness.workflowService.listWorkflowWorkItemEvents(
      identity.tenantId,
      String(workflow.id),
      String(child.id),
      20,
    );
    expect(events.map((event) => event.type)).toEqual([
      'work_item.completed',
      'work_item.reparented',
      'work_item.moved',
      'work_item.updated',
      'work_item.moved',
      'work_item.updated',
      'work_item.created',
    ]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        entity_id: String(child.id),
        data: expect.objectContaining({
          workflow_id: String(workflow.id),
          work_item_id: String(child.id),
          previous_parent_work_item_id: String(parentA.id),
          parent_work_item_id: String(parentB.id),
          previous_column_id: 'implementing',
          column_id: 'done',
        }),
      }),
    );
    expect(events[4]).toEqual(
      expect.objectContaining({
        type: 'work_item.moved',
        data: expect.objectContaining({
          previous_stage_name: 'triage',
          stage_name: 'implementation',
          previous_column_id: 'backlog',
          column_id: 'implementing',
        }),
      }),
    );

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
      'work_item.created',
      'work_item.created',
      'work_item.updated',
      'work_item.updated',
    ]);
  }, 120_000);

  it('runs a standard playbook workflow from launch through gate approval to completion', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Release Flow',
      outcome: 'Approved release',
      definition: {
        roles: ['developer'],
        lifecycle: 'planned',
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'requirements', goal: 'Confirm scope', human_gate: true },
          { name: 'implementation', goal: 'Build the release candidate' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Release Run',
    });
    expect(workflow.current_stage).toBe('requirements');

    const initialStages = await harness.workflowService.listWorkflowStages(
      identity.tenantId,
      String(workflow.id),
    );
    expect(initialStages).toEqual([
      expect.objectContaining({
        name: 'requirements',
        status: 'active',
        gate_status: 'not_requested',
      }),
      expect.objectContaining({
        name: 'implementation',
        status: 'pending',
        gate_status: 'not_requested',
      }),
    ]);

    const requestedStage = await harness.workflowService.requestStageGateApproval(
      identity,
      String(workflow.id),
      'requirements',
      {
        summary: 'Scope is ready for approval',
        recommendation: 'approve',
        concerns: ['Verify rollout sequencing'],
      },
    );
    expect(requestedStage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        status: 'awaiting_gate',
        gate_status: 'awaiting_approval',
      }),
    );
    const [requestedGate] = await approvalQueueService.listWorkflowGates(
      identity.tenantId,
      String(workflow.id),
    );
    expect(requestedGate).toEqual(
      expect.objectContaining({
        workflow_id: workflow.id,
        stage_name: 'requirements',
        gate_status: 'awaiting_approval',
        recommendation: 'approve',
      }),
    );

    const awaitingGateStages = await harness.workflowService.listWorkflowStages(
      identity.tenantId,
      String(workflow.id),
    );
    expect(awaitingGateStages[0]).toEqual(
      expect.objectContaining({
        name: 'requirements',
        status: 'awaiting_gate',
        gate_status: 'awaiting_approval',
      }),
    );

    const approvedStage = await harness.workflowService.actOnStageGate(
      identity,
      String(workflow.id),
      'requirements',
      {
        action: 'approve',
        feedback: 'Release requirements approved',
      },
    );
    expect(approvedStage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        status: 'awaiting_gate',
        gate_status: 'approved',
      }),
    );
    const [approvedGate] = await approvalQueueService.listWorkflowGates(
      identity.tenantId,
      String(workflow.id),
    );
    expect(approvedGate).toEqual(
      expect.objectContaining({
        workflow_id: workflow.id,
        stage_name: 'requirements',
        gate_status: 'approved',
        decision_feedback: 'Release requirements approved',
      }),
    );

    const approvedStages = await harness.workflowService.listWorkflowStages(
      identity.tenantId,
      String(workflow.id),
    );
    expect(approvedStages[0]).toEqual(
      expect.objectContaining({
        name: 'requirements',
        status: 'awaiting_gate',
        gate_status: 'approved',
      }),
    );

    const advanced = await harness.workflowService.advanceWorkflowStage(
      identity,
      String(workflow.id),
      'requirements',
      {
        summary: 'Scope locked and ready for implementation',
      },
    );
    expect(advanced).toEqual({
      completed_stage: 'requirements',
      next_stage: 'implementation',
    });

    const implementationWorkflow = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    expect(implementationWorkflow.current_stage).toBe('implementation');
    expect(implementationWorkflow.state).toBe('active');

    const implementationStages = Array.isArray(implementationWorkflow.workflow_stages)
      ? (implementationWorkflow.workflow_stages as Array<Record<string, unknown>>)
      : [];
    expect(implementationStages).toEqual([
      expect.objectContaining({
        name: 'requirements',
        status: 'completed',
        gate_status: 'approved',
        summary: 'Scope locked and ready for implementation',
      }),
      expect.objectContaining({
        name: 'implementation',
        status: 'active',
        gate_status: 'not_requested',
      }),
    ]);

    const completedWorkflow = await harness.workflowService.completePlaybookWorkflow(
      identity,
      String(workflow.id),
      {
        summary: 'Release candidate shipped',
      },
    );
    expect(completedWorkflow).toEqual({
      workflow_id: workflow.id,
      state: 'completed',
      summary: 'Release candidate shipped',
      final_artifacts: [],
    });

    const hydratedWorkflow = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    expect(hydratedWorkflow.state).toBe('completed');
    expect(hydratedWorkflow.current_stage).toBeNull();

    const hydratedStages = Array.isArray(hydratedWorkflow.workflow_stages)
      ? (hydratedWorkflow.workflow_stages as Array<Record<string, unknown>>)
      : [];
    expect(hydratedStages).toEqual([
      expect.objectContaining({
        name: 'requirements',
        status: 'completed',
        gate_status: 'approved',
      }),
      expect.objectContaining({
        name: 'implementation',
        status: 'completed',
        gate_status: 'not_requested',
        summary: 'Release candidate shipped',
      }),
    ]);

    const workflowEventResult = await db.pool.query<{ type: string; data: Record<string, unknown> }>(
      `SELECT type, data
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'workflow'
          AND entity_id = $2
        ORDER BY created_at ASC, id ASC`,
      [identity.tenantId, String(workflow.id)],
    );
    expect(workflowEventResult.rows.map((row) => row.type)).toEqual([
      'workflow.created',
      'stage.started',
      'workflow.activation_queued',
      'workflow.activation_started',
      'workflow.state_changed',
      'workflow.activation_queued',
      'stage.completed',
      'stage.started',
      'workflow.activation_queued',
      'stage.completed',
      'workflow.state_changed',
      'workflow.completed',
    ]);

    const gateEventResult = await db.pool.query<{ type: string; data: Record<string, unknown> }>(
      `SELECT type, data
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'gate'
          AND data->>'workflow_id' = $2
        ORDER BY created_at ASC, id ASC`,
      [identity.tenantId, String(workflow.id)],
    );
    expect(gateEventResult.rows.map((row) => row.type)).toEqual([
      'stage.gate_requested',
      'stage.gate.approve',
    ]);
    expect(gateEventResult.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stage.gate_requested',
          data: expect.objectContaining({
            stage_name: 'requirements',
            recommendation: 'approve',
          }),
        }),
        expect.objectContaining({
          type: 'stage.gate.approve',
          data: expect.objectContaining({
            stage_name: 'requirements',
            feedback: 'Release requirements approved',
          }),
        }),
      ]),
    );
    expect(workflowEventResult.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'workflow.completed',
          data: expect.objectContaining({
            summary: 'Release candidate shipped',
          }),
        }),
      ]),
    );
  }, 120_000);

  it('completes a planned workflow after stage work finishes even when no explicit checkpoint advance was recorded', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Implicit Completion Flow',
      outcome: 'Implicit stage progression still completes',
      definition: {
        roles: ['developer'],
        lifecycle: 'planned',
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'requirements', goal: 'Define the work' },
          { name: 'implementation', goal: 'Build the result' },
          { name: 'release', goal: 'Wrap up delivery' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Implicit Completion Run',
    });

    const requirementsItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'implicit-complete-req',
        title: 'Confirm requirements',
        stage_name: 'requirements',
        column_id: 'planned',
      },
    );
    await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(requirementsItem.id),
      { column_id: 'done' },
    );

    const implementationItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'implicit-complete-impl',
        title: 'Implement solution',
        stage_name: 'implementation',
        column_id: 'planned',
      },
    );
    await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(implementationItem.id),
      { column_id: 'done' },
    );

    const releaseItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'implicit-complete-release',
        title: 'Release the deliverable',
        stage_name: 'release',
        column_id: 'planned',
      },
    );
    await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(releaseItem.id),
      { column_id: 'done' },
    );

    const rawStagesBeforeCompletion = await db.pool.query<{ name: string; status: string }>(
      `SELECT name, status
         FROM workflow_stages
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY position ASC`,
      [identity.tenantId, String(workflow.id)],
    );
    expect(rawStagesBeforeCompletion.rows).toEqual([
      expect.objectContaining({ name: 'requirements', status: 'completed' }),
      expect.objectContaining({ name: 'implementation', status: 'completed' }),
      expect.objectContaining({ name: 'release', status: 'completed' }),
    ]);

    const completedWorkflow = await harness.workflowService.completePlaybookWorkflow(
      identity,
      String(workflow.id),
      {
        summary: 'All planned stage work finished without explicit checkpoint advances',
      },
    );

    expect(completedWorkflow).toEqual({
      workflow_id: workflow.id,
      state: 'completed',
      summary: 'All planned stage work finished without explicit checkpoint advances',
      final_artifacts: [],
    });

    const rawStagesAfterCompletion = await db.pool.query<{ name: string; status: string }>(
      `SELECT name, status
         FROM workflow_stages
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY position ASC`,
      [identity.tenantId, String(workflow.id)],
    );
    expect(rawStagesAfterCompletion.rows).toEqual([
      expect.objectContaining({ name: 'requirements', status: 'completed' }),
      expect.objectContaining({ name: 'implementation', status: 'completed' }),
      expect.objectContaining({ name: 'release', status: 'completed' }),
    ]);
  }, 120_000);

  it('auto-closes predecessor checkpoint work items and finishes a gated release workflow cleanly', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Successor Closure Flow',
      outcome: 'Planned successor work closes prior checkpoints automatically',
      definition: {
        roles: ['product-manager', 'developer'],
        lifecycle: 'planned',
        board: {
          entry_column_id: 'planned',
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'requirements', goal: 'Scope is confirmed' },
          { name: 'implementation', goal: 'Code is delivered' },
          { name: 'release', goal: 'Release package is approved', human_gate: true },
        ],
        checkpoints: [
          { name: 'requirements', goal: 'Scope is confirmed', human_gate: false },
          { name: 'implementation', goal: 'Code is delivered', human_gate: false },
          { name: 'release', goal: 'Release package is approved', human_gate: true },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Successor Closure Run',
    });

    const requirementsItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'closure-req',
        title: 'Confirm hello world requirements',
        stage_name: 'requirements',
        column_id: 'planned',
      },
    );

    const implementationItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'closure-impl',
        parent_work_item_id: String(requirementsItem.id),
        title: 'Implement hello world',
        stage_name: 'implementation',
        column_id: 'planned',
      },
    );

    const requirementsAfterSuccessor = await harness.workflowService.getWorkflowWorkItem(
      identity.tenantId,
      String(workflow.id),
      String(requirementsItem.id),
    );
    expect(requirementsAfterSuccessor.completed_at).not.toBeNull();
    expect(requirementsAfterSuccessor.column_id).toBe('done');

    const releaseItem = await harness.workflowService.createWorkflowWorkItem(
      identity,
      String(workflow.id),
      {
        request_id: 'closure-release',
        parent_work_item_id: String(implementationItem.id),
        title: 'Prepare hello world release',
        stage_name: 'release',
        column_id: 'planned',
      },
    );

    const implementationAfterSuccessor = await harness.workflowService.getWorkflowWorkItem(
      identity.tenantId,
      String(workflow.id),
      String(implementationItem.id),
    );
    expect(implementationAfterSuccessor.completed_at).not.toBeNull();
    expect(implementationAfterSuccessor.column_id).toBe('done');

    await harness.workflowService.requestStageGateApproval(
      identity,
      String(workflow.id),
      'release',
      {
        summary: 'Release package is ready for approval',
        recommendation: 'approve',
      },
    );
    await harness.workflowService.actOnStageGate(
      identity,
      String(workflow.id),
      'release',
      {
        action: 'approve',
        feedback: 'Release is approved',
      },
    );

    const completedWorkflow = await harness.workflowService.completePlaybookWorkflow(
      identity,
      String(workflow.id),
      {
        summary: 'Hello world release completed cleanly',
      },
    );

    expect(completedWorkflow).toEqual({
      workflow_id: workflow.id,
      state: 'completed',
      summary: 'Hello world release completed cleanly',
      final_artifacts: [],
    });

    const releaseAfterCompletion = await harness.workflowService.getWorkflowWorkItem(
      identity.tenantId,
      String(workflow.id),
      String(releaseItem.id),
    );
    expect(releaseAfterCompletion.completed_at).not.toBeNull();
    expect(releaseAfterCompletion.column_id).toBe('done');

    const finishedWorkflow = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    expect(finishedWorkflow.state).toBe('completed');
    expect(finishedWorkflow.current_stage).toBeNull();

    const finishedStages = Array.isArray(finishedWorkflow.workflow_stages)
      ? (finishedWorkflow.workflow_stages as Array<Record<string, unknown>>)
      : [];
    expect(finishedStages).toEqual([
      expect.objectContaining({ name: 'requirements', status: 'completed', gate_status: 'not_requested' }),
      expect.objectContaining({ name: 'implementation', status: 'completed', gate_status: 'not_requested' }),
      expect.objectContaining({ name: 'release', status: 'completed', gate_status: 'approved' }),
    ]);

    const finishedWorkItems = Array.isArray(finishedWorkflow.work_items)
      ? (finishedWorkflow.work_items as Array<Record<string, unknown>>)
      : [];
    expect(finishedWorkItems).toHaveLength(3);
    expect(finishedWorkItems.every((item) => item.completed_at)).toBe(true);
  }, 120_000);

  it('workspaces grouped multi-milestone workflows through grouped reads and board rollups', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Multi Milestone Flow',
      outcome: 'Milestones delivered',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        board: {
          columns: [
            { id: 'backlog', label: 'Backlog' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'triage', goal: 'Prepare milestone work' },
          { name: 'implementation', goal: 'Execute deliverables' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Multi Milestone Run',
    });

    const milestoneA = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'multi-parent-a',
      title: 'Auth Milestone',
      stage_name: 'triage',
      column_id: 'backlog',
    });
    const milestoneB = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'multi-parent-b',
      title: 'Billing Milestone',
      stage_name: 'implementation',
      column_id: 'active',
    });

    const authDesign = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'multi-child-a1',
      title: 'Auth design',
      parent_work_item_id: String(milestoneA.id),
      stage_name: 'triage',
      column_id: 'backlog',
    });
    const authBuild = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'multi-child-a2',
      title: 'Auth implementation',
      parent_work_item_id: String(milestoneA.id),
      stage_name: 'implementation',
      column_id: 'active',
    });
    const billingBuild = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'multi-child-b1',
      title: 'Billing implementation',
      parent_work_item_id: String(milestoneB.id),
      stage_name: 'implementation',
      column_id: 'done',
    });

    await harness.workflowService.updateWorkflowWorkItem(
      identity,
      String(workflow.id),
      String(authDesign.id),
      {
        stage_name: 'implementation',
        column_id: 'done',
      },
    );

    const groupedWorkItems = await harness.workflowService.listWorkflowWorkItems(
      identity.tenantId,
      String(workflow.id),
      { grouped: true },
    );
    expect(groupedWorkItems).toEqual([
      expect.objectContaining({
        id: String(milestoneA.id),
        children_count: 2,
        is_milestone: true,
        children: [
          expect.objectContaining({
            id: String(authDesign.id),
            column_id: 'done',
            stage_name: 'implementation',
          }),
          expect.objectContaining({
            id: String(authBuild.id),
            column_id: 'active',
            stage_name: 'implementation',
          }),
        ],
      }),
      expect.objectContaining({
        id: String(milestoneB.id),
        children_count: 1,
        is_milestone: true,
        children: [
          expect.objectContaining({
            id: String(billingBuild.id),
            column_id: 'done',
          }),
        ],
      }),
    ]);

    const board = await harness.workflowService.getWorkflowBoard(identity.tenantId, String(workflow.id));
    expect(board.work_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: String(milestoneA.id),
          children_count: 2,
          children_completed: 1,
          is_milestone: true,
          column_id: 'backlog',
        }),
        expect.objectContaining({
          id: String(milestoneB.id),
          children_count: 1,
          children_completed: 1,
          is_milestone: true,
          column_id: 'active',
        }),
      ]),
    );
    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        gate_status: 'not_requested',
        is_active: true,
        work_item_count: 1,
        open_work_item_count: 1,
        completed_count: 0,
      }),
      expect.objectContaining({
        name: 'implementation',
        status: 'active',
        gate_status: 'not_requested',
        is_active: true,
        work_item_count: 4,
        open_work_item_count: 3,
        completed_count: 1,
      }),
    ]);
    expect(board.active_stages).toEqual(['triage', 'implementation']);

    const workflowDetail = await harness.workflowService.getWorkflow(
      identity.tenantId,
      String(workflow.id),
    );
    expect(workflowDetail.work_item_summary).toEqual(
      expect.objectContaining({
        total_work_items: 5,
        open_work_item_count: 3,
        completed_work_item_count: 2,
        active_stage_names: ['triage', 'implementation'],
      }),
    );

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
      'work_item.created',
      'work_item.created',
      'work_item.created',
      'work_item.created',
      'work_item.updated',
    ]);
  }, 120_000);

  it('dispatches batched activations and wakes the orchestrator again after specialist completion', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Continuous Delivery',
      outcome: 'Ship queued work',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        orchestrator: {
          max_active_tasks: 4,
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
        stages: [{ name: 'implementation', goal: 'Implement the requested change' }],
      },
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'runtime-v2-harness',
      runtime_type: 'external',
      connection_mode: 'polling',
      capabilities: ['coding', 'testing', 'git', 'python'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          capabilities: ['coding', 'orchestrator'],
        },
        {
          name: 'developer-specialist',
          execution_mode: 'specialist',
          capabilities: ['coding', 'testing', 'git', 'python'],
        },
      ],
    });
    const orchestratorAgent = registration.agents.find((agent) => agent.name === 'workflow-orchestrator');
    const specialistAgent = registration.agents.find((agent) => agent.name === 'developer-specialist');
    expect(orchestratorAgent).toBeDefined();
    expect(specialistAgent).toBeDefined();

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Continuous Run',
    });
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-contract-1',
      title: 'Implement password reset',
      goal: 'Deliver password reset flow',
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const firstContext = (firstClaim?.context ?? {}) as Record<string, any>;
    expect(firstClaim).toBeTruthy();
    expect(firstClaim?.is_orchestrator_task).toBe(true);
    expect(firstClaim?.activation_id).toBeTruthy();
    expect(firstContext.workflow?.active_stages).toEqual(['implementation']);
    expect(firstContext.workflow?.playbook?.id).toBe(String(playbook.id));
    expect(firstContext.orchestrator?.activation?.event_count).toBe(1);
    expect(firstContext.orchestrator?.activation?.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ event_type: 'workflow.created' })]),
    );

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Reviewed workflow queue and scheduled implementation',
      },
    });

    const implementationTask = await harness.taskService.createTask(identity, {
      title: 'Build password reset flow',
      role: 'developer',
      work_item_id: String(workItem.id),
      request_id: 'specialist-contract-1',
      input: { description: 'Implement password reset UI and API' },
    });

    const specialistClaim = await harness.taskService.claimTask(agentIdentity(String(specialistAgent?.id)), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'testing', 'git', 'python'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const specialistContext = (specialistClaim?.context ?? {}) as Record<string, any>;
    expect(specialistClaim?.id).toBe(implementationTask.id);
    expect(specialistClaim?.is_orchestrator_task).toBe(false);
    expect(specialistContext.task?.work_item?.id).toBe(String(workItem.id));
    expect(specialistContext.workflow?.active_stages).toEqual(['implementation']);

    await harness.taskService.startTask(agentIdentity(String(specialistAgent?.id)), String(specialistClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
    });
    await harness.taskService.completeTask(agentIdentity(String(specialistAgent?.id)), String(specialistClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Password reset delivered',
      },
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const secondClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const secondContext = (secondClaim?.context ?? {}) as Record<string, any>;
    expect(secondClaim).toBeTruthy();
    expect(secondClaim?.is_orchestrator_task).toBe(true);
    expect(secondContext.orchestrator?.activation?.events).toEqual(
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

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(secondClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(secondClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Observed queued specialist completion',
      },
    });

    const thirdClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    const thirdContext = (thirdClaim?.context ?? {}) as Record<string, any>;
    expect(thirdClaim).toBeTruthy();
    expect(thirdClaim?.is_orchestrator_task).toBe(true);
    expect(thirdContext.orchestrator?.activation?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'task.completed',
          payload: expect.objectContaining({
            task_id: String(implementationTask.id),
            work_item_id: String(workItem.id),
            stage_name: 'implementation',
          }),
        }),
      ]),
    );

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations).toHaveLength(3);
    expect(activations.map((activation) => activation.event_count)).toEqual([1, 1, 1]);
    expect(activations[0]?.state).toBe('completed');
    expect(activations[1]?.state).toBe('completed');
    expect(activations[2]?.state).toBe('processing');
  }, 120_000);

  it('keeps trigger-created work items on the configured stage and board column while parallelism caps queue later tasks', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const webhookTriggerService = new WebhookWorkItemTriggerService(
      db.pool,
      harness.eventService,
      harness.workflowService,
      '12345678901234567890123456789012',
    );
    const scheduledTriggerService = new ScheduledWorkItemTriggerService(
      db.pool,
      harness.eventService,
      harness.workflowService,
    );

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Triggered Intake',
      outcome: 'Process triggered work safely',
      definition: {
        roles: ['developer'],
        lifecycle: 'ongoing',
        orchestrator: {
          max_active_tasks: 1,
          max_active_tasks_per_work_item: 1,
          allow_parallel_work_items: false,
        },
        board: {
          columns: [
            { id: 'backlog', label: 'Backlog' },
            { id: 'implementing', label: 'Implementing' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'triage', goal: 'Intake the request' },
          { name: 'implementation', goal: 'Deliver the requested change' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Triggered Run',
    });
    const registration = await harness.workerService.registerWorker(identity, {
      name: 'triggered-run-specialist',
      runtime_type: 'external',
      connection_mode: 'polling',
      capabilities: ['coding', 'testing', 'git', 'python'],
      agents: [
        {
          name: 'developer-specialist',
          execution_mode: 'specialist',
          capabilities: ['coding', 'testing', 'git', 'python'],
        },
      ],
    });
    const specialistAgent = registration.agents.find((agent) => agent.name === 'developer-specialist');
    expect(specialistAgent).toBeDefined();

    const webhookTrigger = await webhookTriggerService.createTrigger(identity, {
      name: 'GitHub issue opened',
      source: 'github',
      workflow_id: String(workflow.id),
      event_header: 'X-Event-Type',
      event_types: ['github.issue_opened'],
      signature_header: 'X-Signature',
      signature_mode: 'hmac_sha256',
      secret: 'webhook-secret',
      field_mappings: {
        title: 'issue.title',
        goal: 'details',
        dedupe_key: 'dedupe',
      },
      defaults: {
        owner_role: 'triager',
        stage_name: 'triage',
        column_id: 'backlog',
        priority: 'high',
      },
    });

    const webhookPayload = {
      issue: { title: 'Investigate login regression' },
      details: 'Identify the cause and fix it.',
      dedupe: 'issue-evt-1',
    };
    const webhookBody = Buffer.from(JSON.stringify(webhookPayload));
    const webhookSignature = `sha256=${createHmac('sha256', 'webhook-secret').update(webhookBody).digest('hex')}`;

    const firstWebhookResult = await webhookTriggerService.invokeTrigger(
      String(webhookTrigger.id),
      {
        'x-signature': webhookSignature,
        'x-event-type': 'github.issue_opened',
      },
      webhookBody,
      webhookPayload,
    );
    const duplicateWebhookResult = await webhookTriggerService.invokeTrigger(
      String(webhookTrigger.id),
      {
        'x-signature': webhookSignature,
        'x-event-type': 'github.issue_opened',
      },
      webhookBody,
      webhookPayload,
    );

    expect(firstWebhookResult).toEqual(
      expect.objectContaining({
        accepted: true,
        created: true,
        event_type: 'github.issue_opened',
      }),
    );
    expect(duplicateWebhookResult).toEqual(
      expect.objectContaining({
        accepted: true,
        created: false,
        duplicate: true,
        work_item_id: firstWebhookResult.work_item_id,
      }),
    );

    await scheduledTriggerService.createTrigger(identity, {
      name: 'Implementation sweep',
      source: 'system.schedule',
      workflow_id: String(workflow.id),
      cadence_minutes: 60,
      next_fire_at: '2026-03-11T10:00:00.000Z',
      defaults: {
        title: 'Process the queued implementation batch',
        goal: 'Work the next triggered item',
        owner_role: 'developer',
        stage_name: 'implementation',
        column_id: 'implementing',
        priority: 'critical',
      },
    });

    const scheduledResult = await scheduledTriggerService.fireDueTriggers(
      new Date('2026-03-11T10:00:00.000Z'),
    );
    expect(scheduledResult).toEqual({
      claimed: 1,
      fired: 1,
      duplicates: 0,
      failed: 0,
    });

    const workItems = await harness.workflowService.listWorkflowWorkItems(
      identity.tenantId,
      String(workflow.id),
    );
    expect(workItems).toHaveLength(2);

    const triageItem = workItems.find((entry) => entry.id === firstWebhookResult.work_item_id);
    const implementationItem = workItems.find((entry) => entry.id !== firstWebhookResult.work_item_id);

    expect(triageItem).toEqual(
      expect.objectContaining({
        stage_name: 'triage',
        column_id: 'backlog',
        priority: 'high',
      }),
    );
    expect(implementationItem).toEqual(
      expect.objectContaining({
        stage_name: 'implementation',
        column_id: 'implementing',
        priority: 'critical',
      }),
    );

    const firstTask = await harness.taskService.createTask(identity, {
      title: 'Triage the triggered login regression',
      role: 'developer',
      work_item_id: String(triageItem?.id),
      request_id: 'trigger-task-1',
      input: { description: 'Review and fix the login regression' },
    });
    const secondTask = await harness.taskService.createTask(identity, {
      title: 'Handle the scheduled implementation batch',
      role: 'developer',
      work_item_id: String(implementationItem?.id),
      request_id: 'trigger-task-2',
      input: { description: 'Process the next scheduled implementation item' },
    });

    expect(firstTask).toEqual(
      expect.objectContaining({
        stage_name: 'triage',
        state: 'ready',
      }),
    );
    expect(secondTask).toEqual(
      expect.objectContaining({
        stage_name: 'implementation',
        state: 'pending',
      }),
    );

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(specialistAgent?.id)), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'testing', 'git', 'python'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(firstClaim?.id).toBe(firstTask.id);
    expect(firstClaim?.work_item_id).toBe(triageItem?.id);

    await harness.taskService.startTask(agentIdentity(String(specialistAgent?.id)), String(firstClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
    });
    await harness.taskService.completeTask(agentIdentity(String(specialistAgent?.id)), String(firstClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Triage finished',
      },
    });

    const promotedSecondTask = await harness.taskService.getTask(identity.tenantId, String(secondTask.id));
    expect(promotedSecondTask.state).toBe('ready');

    const secondClaim = await harness.taskService.claimTask(agentIdentity(String(specialistAgent?.id)), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'testing', 'git', 'python'],
      include_context: true,
      playbook_id: String(playbook.id),
    });
    expect(secondClaim?.id).toBe(secondTask.id);
    expect(secondClaim?.work_item_id).toBe(implementationItem?.id);

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations.map((activation) => activation.event_type)).toEqual([
      'workflow.created',
      'work_item.created',
      'work_item.created',
      'task.completed',
    ]);
  }, 120_000);

  it('links orchestrator-created child workflows back to the parent and reactivates the parent on child completion', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const parentPlaybook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Parent Flow',
      outcome: 'Coordinate child workflows',
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
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Coordinate delivery' }],
      },
    });
    const childPlaybook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Child Flow',
      outcome: 'Deliver a child workflow outcome',
      definition: {
        roles: ['developer'],
        lifecycle: 'planned',
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Finish the child scope' }],
      },
    });

    const registration = await harness.workerService.registerWorker(identity, {
      name: 'runtime-child-linkage',
      runtime_type: 'external',
      connection_mode: 'polling',
      capabilities: ['coding', 'testing', 'git', 'python'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          capabilities: ['coding', 'orchestrator'],
        },
      ],
    });
    const orchestratorAgent = registration.agents.find((agent) => agent.name === 'workflow-orchestrator');
    expect(orchestratorAgent).toBeDefined();

    const parentWorkflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(parentPlaybook.id),
      name: 'Parent Run',
    });

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const parentClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['coding', 'orchestrator'],
      include_context: true,
      playbook_id: String(parentPlaybook.id),
    });
    expect(parentClaim?.is_orchestrator_task).toBe(true);
    expect(parentClaim?.activation_id).toBeTruthy();

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(parentClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });

    const orchestratorApp = await createOrchestratorControlTestApp(db, harness);
    try {
      const childCreateResponse = await orchestratorApp.inject({
        method: 'POST',
        url: `/api/v1/orchestrator/tasks/${String(parentClaim?.id)}/workflows`,
        headers: {
          authorization: 'Bearer test',
          'x-test-owner-id': String(orchestratorAgent?.id),
        },
        payload: {
          request_id: 'child-link-1',
          playbook_id: String(childPlaybook.id),
          name: 'Child Run',
          parent_context: 'Inspect downstream release signals.',
          metadata: {
            source_kind: 'orchestrator-test',
          },
        },
      });

      expect(childCreateResponse.statusCode).toBe(201);
      const childWorkflow = childCreateResponse.json().data as Record<string, unknown>;

      const loadedChildWorkflow = await harness.workflowService.getWorkflow(
        identity.tenantId,
        String(childWorkflow.id),
      );
      const childMetadata = (loadedChildWorkflow.metadata ?? {}) as Record<string, unknown>;
      expect(childMetadata).toEqual(
        expect.objectContaining({
          parent_workflow_id: parentWorkflow.id,
          parent_orchestrator_task_id: parentClaim?.id,
          parent_orchestrator_activation_id: parentClaim?.activation_id,
          parent_context: 'Inspect downstream release signals.',
          parent_link_kind: 'orchestrator_child',
        }),
      );

      const loadedParentWorkflow = await harness.workflowService.getWorkflow(
        identity.tenantId,
        String(parentWorkflow.id),
      );
      const parentMetadata = (loadedParentWorkflow.metadata ?? {}) as Record<string, unknown>;
      expect(parentMetadata).toEqual(
        expect.objectContaining({
          latest_child_workflow_id: childWorkflow.id,
          latest_child_workflow_created_by_orchestrator_task_id: parentClaim?.id,
          child_workflow_ids: expect.arrayContaining([childWorkflow.id]),
        }),
      );

      await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(parentClaim?.id), {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        output: {
          summary: 'Spawned a child workflow for follow-up orchestration',
        },
      });

      const completedChildWorkflow = await harness.workflowService.completePlaybookWorkflow(
        identity,
        String(childWorkflow.id),
        {
          summary: 'Child workflow delivered the requested outcome',
        },
      );
      expect(completedChildWorkflow.state).toBe('completed');

      const parentActivationsAfterChild = await harness.workflowActivationService.listWorkflowActivations(
        identity.tenantId,
        String(parentWorkflow.id),
      );
      const childOutcomeActivation = parentActivationsAfterChild.find(
        (activation) => activation.event_type === 'child_workflow.completed',
      );
      expect(childOutcomeActivation).toEqual(
        expect.objectContaining({
          workflow_id: parentWorkflow.id,
          state: 'queued',
          payload: expect.objectContaining({
            child_workflow_id: childWorkflow.id,
            child_workflow_state: 'completed',
            parent_workflow_id: parentWorkflow.id,
            parent_orchestrator_task_id: parentClaim?.id,
            parent_orchestrator_activation_id: parentClaim?.activation_id,
          }),
        }),
      );

      await runWorkflowActivationDispatchTick(
        harness.logger as never,
        harness.workflowActivationDispatchService,
      );

      const resumedParentClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
        agent_id: String(orchestratorAgent?.id),
        worker_id: registration.worker_id,
        capabilities: ['coding', 'orchestrator'],
        include_context: true,
        playbook_id: String(parentPlaybook.id),
      });
      const resumedContext = (resumedParentClaim?.context ?? {}) as Record<string, any>;
      expect(resumedParentClaim?.is_orchestrator_task).toBe(true);
      expect(resumedParentClaim?.activation_id).toBeTruthy();
      expect(resumedContext.orchestrator?.activation?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'child_workflow.completed',
            payload: expect.objectContaining({
              child_workflow_id: childWorkflow.id,
              child_workflow_state: 'completed',
              parent_workflow_id: parentWorkflow.id,
              parent_orchestrator_activation_id: parentClaim?.activation_id,
            }),
          }),
        ]),
      );
    } finally {
      await orchestratorApp.close();
    }
  }, 120_000);
});
