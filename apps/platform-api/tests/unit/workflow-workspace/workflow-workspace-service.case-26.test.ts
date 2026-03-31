import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../src/services/workflow-operations/workflow-workspace-service.js';

const briefsService = {
  getBriefs: vi.fn(async () => ({
    snapshot_version: 'workflow-operations:120',
    generated_at: '2026-03-27T22:45:00.000Z',
    latest_event_id: 120,
    items: [],
    total_count: 0,
    next_cursor: null,
  })),
};

describe('WorkflowWorkspaceService', () => {
  it('keeps workflow-document fallback deliverables visible in selected work-item scope', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'done', is_terminal: true }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Only work item',
            stage_name: 'terminal',
            column_id: 'done',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 0,
            children_count: 0,
            completed_at: '2026-03-28T05:00:00.000Z',
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Planned terminal brief',
        posture: 'completed',
        pulse: { summary: 'Workflow is complete.' },
        outputDescriptors: [
          {
            id: 'workflow-document:terminal-brief',
            title: 'Terminal brief',
            summary: 'Operator-ready terminal brief.',
            status: 'final',
            producedByRole: null,
            workItemId: null,
            taskId: 'task-1',
            stageName: 'terminal',
            primaryLocation: {
              kind: 'workflow_document',
              logicalName: 'Terminal brief',
              location: 'docs/terminal-brief.md',
              artifactId: 'document-1',
            },
            secondaryLocations: [],
          },
        ],
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
          lastChangedAt: '2026-03-28T05:00:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:140',
        generated_at: '2026-03-28T05:00:00.000Z',
        latest_event_id: 140,
        items: [],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:140',
        generated_at: '2026-03-28T05:00:00.000Z',
        latest_event_id: 140,
        groups: [],
        items: [],
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
        all_deliverables: [],
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
      interventionService as never,
      steeringSessionService as never,
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:workflow-document:terminal-brief',
        work_item_id: null,
        descriptor_kind: 'workflow_document',
        title: 'Terminal brief',
      }),
    ]);
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
  });

});
