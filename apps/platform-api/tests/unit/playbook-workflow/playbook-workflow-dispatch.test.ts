import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../../src/jobs/lifecycle-monitor.js';
import { HandoffService } from '../../../src/services/handoff-service.js';
import { WorkflowOperatorBriefService } from '../../../src/services/workflow-operator-brief-service.js';
import { TEST_IDENTITY as identity, agentIdentity } from '../helpers/v2-harness.js';
import {
  setupPlaybookWorkflowIntegrationSuite,
  type PlaybookWorkflowIntegrationSuite,
} from './playbook-workflow.integration.setup.js';

let suite: PlaybookWorkflowIntegrationSuite;

beforeAll(async () => {
  suite = await setupPlaybookWorkflowIntegrationSuite();
}, 120_000);

afterAll(async () => {
  await suite.cleanup();
});

describe('playbook workflow integration', () => {
  it('dispatches batched activations and wakes the orchestrator again after specialist completion', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const dispatchLogger = {
      ...harness.logger,
      debug: harness.logger.info.bind(harness.logger),
    };

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
      routing_tags: ['coding', 'testing', 'git', 'python'],
      agents: [
        {
          name: 'workflow-orchestrator',
          execution_mode: 'orchestrator',
          routing_tags: ['coding', 'orchestrator'],
        },
        {
          name: 'developer-specialist',
          execution_mode: 'specialist',
          routing_tags: ['coding', 'testing', 'git', 'python', 'role:developer'],
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
      dispatchLogger as never,
      harness.workflowActivationDispatchService,
    );
    const handoffService = new HandoffService(suite.db!.pool);
    const workflowOperatorBriefService = new WorkflowOperatorBriefService(suite.db!.pool);
    const recordOrchestratorBrief = async (
      taskId: string,
      executionContextId: string,
      headline: string,
      sourceKind: 'orchestrator' | 'specialist',
      sourceRoleName: string,
    ) => {
      await workflowOperatorBriefService.recordBrief(identity, String(workflow.id), {
        requestId: `operator-brief:${executionContextId}:${taskId}`,
        executionContextId,
        sourceKind,
        sourceRoleName,
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

    const firstClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      playbook_id: String(playbook.id),
    });
    expect(firstClaim).toBeTruthy();
    expect(firstClaim?.is_orchestrator_task).toBe(true);
    expect(firstClaim?.activation_id).toBeTruthy();
    const workflowRead = await harness.workflowService.getWorkflow(identity.tenantId, String(workflow.id));
    expect(workflowRead.active_stages).toEqual(['implementation']);

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(firstClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(firstClaim?.id), {
      request_id: 'orchestrator-handoff-1',
      summary: 'Reviewed workflow queue and scheduled implementation',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(firstClaim?.id),
      String(firstClaim?.activation_id),
      'Reviewed workflow queue and scheduled implementation',
      'orchestrator',
      'Orchestrator',
    );
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
      routing_tags: ['coding', 'testing', 'git', 'python', 'role:developer'],
      playbook_id: String(playbook.id),
    });
    expect(specialistClaim?.id).toBe(implementationTask.id);
    expect(specialistClaim?.is_orchestrator_task).toBe(false);

    await harness.taskService.startTask(agentIdentity(String(specialistAgent?.id)), String(specialistClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(specialistClaim?.id), {
      request_id: 'specialist-handoff-1',
      summary: 'Password reset implementation is complete.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(specialistClaim?.id),
      String(specialistClaim?.id),
      'Password reset implementation is complete.',
      'specialist',
      'Developer',
    );
    await harness.taskService.completeTask(agentIdentity(String(specialistAgent?.id)), String(specialistClaim?.id), {
      agent_id: String(specialistAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Password reset delivered',
      },
    });

    await runWorkflowActivationDispatchTick(
      dispatchLogger as never,
      harness.workflowActivationDispatchService,
    );

    const secondClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      playbook_id: String(playbook.id),
    });
    expect(secondClaim).toBeTruthy();
    expect(secondClaim?.is_orchestrator_task).toBe(true);

    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(secondClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(secondClaim?.id), {
      request_id: 'orchestrator-handoff-2',
      summary: 'Observed queued specialist completion.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(secondClaim?.id),
      String(secondClaim?.activation_id),
      'Observed queued specialist completion.',
      'orchestrator',
      'Orchestrator',
    );
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(secondClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Observed queued specialist completion',
      },
    });

    await runWorkflowActivationDispatchTick(
      dispatchLogger as never,
      harness.workflowActivationDispatchService,
    );

    const thirdClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
      playbook_id: String(playbook.id),
    });
    expect(thirdClaim).toBeTruthy();
    expect(thirdClaim?.is_orchestrator_task).toBe(true);
    await handoffService.submitTaskHandoff(identity.tenantId, String(thirdClaim?.id), {
      request_id: 'orchestrator-handoff-3',
      summary: 'Observed queued specialist completion.',
      completion: 'full',
      remaining_items: [],
    });
    await recordOrchestratorBrief(
      String(thirdClaim?.id),
      String(thirdClaim?.activation_id),
      'Observed queued specialist completion.',
      'orchestrator',
      'Orchestrator',
    );
    await harness.taskService.startTask(agentIdentity(String(orchestratorAgent?.id)), String(thirdClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
    });
    await harness.taskService.completeTask(agentIdentity(String(orchestratorAgent?.id)), String(thirdClaim?.id), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      output: {
        summary: 'Observed queued specialist completion',
      },
    });

    const activations = await harness.workflowActivationService.listWorkflowActivations(
      identity.tenantId,
      String(workflow.id),
    );
    expect(activations).toHaveLength(3);
    expect(activations.map((activation) => activation.event_count)).toEqual([1, 1, 0]);
    expect(activations[0]?.state).toBe('completed');
    expect(activations[1]?.state).toBe('completed');
    expect(activations[2]?.state).toBe('completed');
  }, 120_000);
});
