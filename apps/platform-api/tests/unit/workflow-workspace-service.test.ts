import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../src/services/workflow-operations/workflow-workspace-service.js';

describe('WorkflowWorkspaceService', () => {
  it('composes sticky strip, bottom tabs, board, and workbench packets for a selected workflow', async () => {
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
        items: [{ item_id: 'console-1' }],
        next_cursor: null,
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        groups: [{ group_id: '2026-03-27', item_ids: ['history-1'] }],
        items: [{ item_id: 'history-1' }],
        filters: { available: ['briefs'], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [{ id: 'deliverable-1' }],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
      })),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
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
          live_console: 1,
          history: 1,
          deliverables: 1,
        }),
      }),
    );
    expect(result.board).toEqual({
      columns: [{ id: 'verification' }],
      work_items: [],
    });
  });
});
