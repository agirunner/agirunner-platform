import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../src/services/workflow-operations/workflow-workspace-service.js';

describe('WorkflowWorkspaceService', () => {
  it('composes sticky strip, board, workbench tabs, steering state, and deliverable-backed overview data', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({
        parameters: { objective: 'ship the release' },
        context: { attempt_reason: 'baseline' },
        workflow_relations: { parent: null, children: [] },
      })),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'verification' }],
        work_items: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on operator approval' },
        availableActions: [{ kind: 'pause_workflow', enabled: true, scope: 'workflow' }],
        metrics: {
          blockedWorkItemCount: 1,
          openEscalationCount: 2,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
          activeTaskCount: 2,
          activeWorkItemCount: 3,
          lastChangedAt: '2026-03-27T22:45:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{ item_id: 'console-1' }],
        next_cursor: null,
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        groups: [{ group_id: '2026-03-27', item_ids: ['history-1'], label: '2026-03-27', anchor_at: '2026-03-27T00:00:00.000Z' }],
        items: [{ item_id: 'history-1', item_kind: 'milestone_brief', headline: 'Ready for approval', summary: 'Review required.', created_at: '2026-03-27T22:44:00.000Z', linked_target_ids: ['workflow-1'] }],
        filters: { available: ['briefs'], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [{ descriptor_id: 'deliverable-1', title: 'Release Notes' }],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
        all_deliverables: [{ descriptor_id: 'deliverable-1', title: 'Release Notes' }],
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => [
        {
          id: 'intervention-1',
          summary: 'Paused for review',
        },
      ]),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => [
        {
          id: 'session-1',
          workflow_id: 'workflow-1',
          title: 'Recovery session',
          status: 'open',
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:40:00.000Z',
        },
      ]),
      listMessages: vi.fn(async () => [
        {
          id: 'message-1',
          workflow_id: 'workflow-1',
          steering_session_id: 'session-1',
          source_kind: 'operator',
          message_kind: 'operator_request',
          headline: 'Focus on approval path first.',
          body: null,
          linked_intervention_id: null,
          linked_input_packet_id: null,
          linked_operator_update_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:31:00.000Z',
        },
      ]),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
      interventionService as never,
      steeringSessionService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.sticky_strip).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        workflow_name: 'Release Workflow',
        posture: 'needs_decision',
        approvals_count: 1,
        escalations_count: 2,
      }),
    );
    expect(result.bottom_tabs).toEqual(
      expect.objectContaining({
        default_tab: 'needs_action',
        counts: expect.objectContaining({
          needs_action: 1,
          steering: 1,
          live_console: 1,
          history: 1,
          deliverables: 1,
        }),
      }),
    );
    expect(result.steering_panel).toEqual(
      expect.objectContaining({
        recent_interventions: [expect.objectContaining({ id: 'intervention-1' })],
        session: expect.objectContaining({
          session_id: 'session-1',
          status: 'open',
          messages: [expect.objectContaining({ id: 'message-1' })],
        }),
      }),
    );
    expect(result.overview).toEqual(
      expect.objectContaining({
        currentOperatorAsk: 'Waiting on operator approval',
        latestOutput: expect.objectContaining({ descriptor_id: 'deliverable-1' }),
      }),
    );
    expect(result.board).toEqual({
      columns: [{ id: 'verification' }],
      work_items: [],
    });
  });
});
