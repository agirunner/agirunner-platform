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
  it('runs a standard playbook workflow from launch through gate approval to completion', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const db = suite.db!;
    const approvalQueueService = suite.approvalQueueService!;

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
        status: 'active',
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
        status: 'active',
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
      completion_callouts: {
        residual_risks: [],
        unmet_preferred_expectations: [],
        waived_steps: [],
        unresolved_advisory_items: [],
        completion_notes: null,
      },
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
});
