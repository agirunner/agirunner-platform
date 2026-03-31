import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowActivationDispatchTick } from '../../../../src/jobs/lifecycle-monitor.js';
import { HandoffService } from '../../../../src/services/handoff-service.js';
import { WorkflowOperatorBriefService } from '../../../../src/services/workflow-operator-brief-service.js';
import { createOrchestratorControlTestApp, TEST_IDENTITY as identity, agentIdentity } from '../workflow-runtime/v2-harness.js';
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
  it('links orchestrator-created child workflows back to the parent and reactivates the parent on child completion', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const db = suite.db!;

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
      routing_tags: ['coding', 'testing', 'git', 'python'],
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

    const parentWorkflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(parentPlaybook.id),
      name: 'Parent Run',
    });
    const handoffService = new HandoffService(db.pool);
    const workflowOperatorBriefService = new WorkflowOperatorBriefService(db.pool);

    await runWorkflowActivationDispatchTick(
      harness.logger as never,
      harness.workflowActivationDispatchService,
    );

    const parentClaim = await harness.taskService.claimTask(agentIdentity(String(orchestratorAgent?.id)), {
      agent_id: String(orchestratorAgent?.id),
      worker_id: registration.worker_id,
      routing_tags: ['coding', 'orchestrator'],
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

      await handoffService.submitTaskHandoff(identity.tenantId, String(parentClaim?.id), {
        request_id: 'child-link-parent-handoff',
        summary: 'Spawned a child workflow for follow-up orchestration',
        completion: 'full',
        remaining_items: [],
      });
      await workflowOperatorBriefService.recordBrief(identity, String(parentWorkflow.id), {
        requestId: `operator-brief:${String(parentClaim?.activation_id)}:child-link`,
        executionContextId: String(parentClaim?.activation_id),
        sourceKind: 'orchestrator',
        sourceRoleName: 'Orchestrator',
        briefKind: 'milestone',
        payload: {
          shortBrief: {
            headline: 'Spawned a child workflow for follow-up orchestration',
          },
          detailedBriefJson: {
            headline: 'Spawned a child workflow for follow-up orchestration',
            status_kind: 'completed',
            summary: 'The parent workflow spawned a child workflow and is ready to close.',
          },
        },
      });

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
        routing_tags: ['coding', 'orchestrator'],
        playbook_id: String(parentPlaybook.id),
      });
      expect(resumedParentClaim?.is_orchestrator_task).toBe(true);
      expect(resumedParentClaim?.activation_id).toBeTruthy();
    } finally {
      await orchestratorApp.close();
    }
  }, 120_000);
});
