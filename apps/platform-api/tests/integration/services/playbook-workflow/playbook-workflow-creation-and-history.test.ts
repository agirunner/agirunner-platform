import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_IDENTITY as identity } from '../workflow-runtime/v2-harness.js';
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
  it('creates a playbook workflow, work item, and idempotent linked task', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const workflowChainingService = suite.workflowChainingService!;

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
    expect(hydratedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'orchestrator',
          activation_id: expect.any(String),
          work_item_id: null,
        }),
        expect.objectContaining({
          role: 'developer',
          work_item_id: String(workItem.id),
        }),
      ]),
    );
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
      blocked_work_item_count: 0,
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
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;

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
});
