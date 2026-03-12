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
      capabilities: ['llm-api', 'role:developer'],
      escalationTarget: 'human',
      maxEscalationDepth: 3,
    });

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Escalation Flow',
      outcome: 'Specialist resumes after operator guidance',
      definition: {
        roles: ['developer'],
        lifecycle: 'continuous',
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
      capabilities: ['llm-api'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          capabilities: ['llm-api', 'orchestrator'],
        },
        {
          name: 'developer-specialist',
          execution_mode: 'specialist',
          capabilities: ['llm-api', 'role:developer'],
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
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-escalation-1',
      title: 'Handle edge-case policy branch',
      goal: 'Finish implementation with operator guidance if blocked',
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
        capabilities: ['llm-api', 'orchestrator'],
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
        capabilities: ['llm-api', 'orchestrator'],
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
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(workItemOrchestratorClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Registered the queued work item for specialist execution',
      },
    });

    const specialistTask = await harness.taskService.createTask(identity, {
      title: 'Implement policy edge case',
      role: 'developer',
      work_item_id: String(workItem.id),
      request_id: 'specialist-escalation-1',
      input: { description: 'Implement the policy branch and escalate if guidance is required' },
    });

    const specialistClaim = await harness.taskService.claimTask(agentIdentity(String(specialistAgent?.id)), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      capabilities: ['llm-api', 'role:developer'],
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
        capabilities: ['llm-api', 'orchestrator'],
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
        capabilities: ['llm-api', 'orchestrator'],
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
        capabilities: ['llm-api', 'role:developer'],
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
