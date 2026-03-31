import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../../src/services/workflow-operations/workflow-workspace-service.js';

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
  it('uses scoped packet totals for bottom-tab counts instead of the current page length', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Workflow 1',
        posture: 'active',
        pulse: { summary: 'Working' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 1,
          activeWorkItemCount: 1,
          lastChangedAt: '2026-03-27T22:45:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{ item_id: 'console-1' }, { item_id: 'console-2' }],
        total_count: 44,
        next_cursor: 'cursor:console',
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        groups: [],
        items: [{ item_id: 'history-1' }],
        total_count: 61,
        filters: { available: ['briefs'], active: [] },
        next_cursor: 'cursor:history',
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
    const briefsService = {
      getBriefs: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{ brief_id: 'brief-1' }, { brief_id: 'brief-2' }],
        total_count: 17,
        next_cursor: 'cursor:briefs',
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.live_console.items).toHaveLength(2);
    expect(result.history.items).toHaveLength(1);
    expect(result.briefs.items).toHaveLength(2);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(44);
    expect(result.bottom_tabs.counts.briefs).toBe(17);
    expect(result.bottom_tabs.counts.history).toBe(61);
  });

});
