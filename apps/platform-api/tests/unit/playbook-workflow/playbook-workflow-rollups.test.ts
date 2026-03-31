import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_IDENTITY as identity } from '../../helpers/v2-harness.js';
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
  it('workspaces grouped multi-milestone workflows through grouped reads and board rollups', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;

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
          children_completed: 0,
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
        open_work_item_count: 4,
        completed_work_item_count: 1,
        active_stage_names: ['triage', 'implementation'],
        awaiting_gate_count: 0,
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
});
