import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_IDENTITY as identity } from '../../helpers/v2-harness.js';
import { HandoffService } from '../../../src/services/handoff-service.js';
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
  it('completes a planned workflow after stage work finishes even when no explicit checkpoint advance was recorded', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const db = suite.db!;

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
      completion_callouts: {
        residual_risks: [],
        unmet_preferred_expectations: [],
        waived_steps: [],
        unresolved_advisory_items: [],
        completion_notes: null,
      },
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
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const db = suite.db!;
    const handoffService = new HandoffService(db.pool);

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
    const requirementsTask = await harness.taskService.createTask(identity, {
      request_id: 'closure-req-task',
      title: 'Confirm requirements',
      work_item_id: String(requirementsItem.id),
      stage_name: 'requirements',
      role: 'product-manager',
      input: { description: 'Confirm hello world requirements.' },
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(requirementsTask.id), {
      request_id: 'closure-req-handoff',
      summary: 'Requirements are confirmed.',
      completion: 'full',
      remaining_items: [],
    });
    await db.pool.query(
      `UPDATE tasks
          SET state = 'completed',
              completed_at = now(),
              state_changed_at = now(),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(requirementsTask.id)],
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
    const implementationTask = await harness.taskService.createTask(identity, {
      request_id: 'closure-impl-task',
      title: 'Implement hello world',
      work_item_id: String(implementationItem.id),
      stage_name: 'implementation',
      role: 'developer',
      input: { description: 'Implement hello world.' },
    });
    await handoffService.submitTaskHandoff(identity.tenantId, String(implementationTask.id), {
      request_id: 'closure-impl-handoff',
      summary: 'Implementation is complete.',
      completion: 'full',
      remaining_items: [],
    });
    await db.pool.query(
      `UPDATE tasks
          SET state = 'completed',
              completed_at = now(),
              state_changed_at = now(),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(implementationTask.id)],
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
      completion_callouts: {
        residual_risks: [],
        unmet_preferred_expectations: [],
        waived_steps: [],
        unresolved_advisory_items: [],
        completion_notes: null,
      },
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
});
