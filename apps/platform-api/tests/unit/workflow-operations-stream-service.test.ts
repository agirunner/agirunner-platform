import { describe, expect, it, vi } from 'vitest';

import { WorkflowOperationsStreamService } from '../../src/services/workflow-operations/workflow-operations-stream-service.js';

describe('WorkflowOperationsStreamService', () => {
  it('emits typed workspace delta packets instead of replaying legacy snapshot fragments', async () => {
    const railService = {
      getRail: vi.fn(),
    };
    const workspaceService = {
      getWorkspace: vi.fn(async () => ({
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        snapshot_version: 'workflow-operations:120',
        workflow_id: 'workflow-1',
        selected_scope: { scope_kind: 'workflow', work_item_id: null },
        sticky_strip: { workflow_id: 'workflow-1' },
        board: { lanes: [] },
        bottom_tabs: {
          default_tab: 'needs_action',
          current_scope_kind: 'workflow',
          current_work_item_id: null,
          counts: {
            needs_action: 1,
            steering: 1,
            live_console_activity: 2,
            history: 3,
            deliverables: 4,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { quick_actions: [], decision_actions: [], recent_interventions: [], session: null },
        live_console: {
          generated_at: '2026-03-27T22:45:00.000Z',
          latest_event_id: 120,
          snapshot_version: 'workflow-operations:120',
          items: [{ item_id: 'console-1', created_at: '2026-03-27T22:46:00.000Z' }],
          next_cursor: 'console-cursor',
          live_visibility_mode: 'enhanced',
        },
        history: {
          generated_at: '2026-03-27T22:45:00.000Z',
          latest_event_id: 120,
          snapshot_version: 'workflow-operations:120',
          groups: [],
          items: [{ item_id: 'history-1', created_at: '2026-03-27T22:46:00.000Z' }],
          filters: { available: [], active: [] },
          next_cursor: 'history-cursor',
        },
        deliverables: {
          final_deliverables: [{ descriptor_id: 'deliverable-1', created_at: '2026-03-27T22:46:00.000Z', updated_at: '2026-03-27T22:47:00.000Z' }],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: 'deliverables-cursor',
        },
        redrive_lineage: null,
      })),
    };

    const service = new WorkflowOperationsStreamService(
      railService as never,
      workspaceService as never,
    );

    const result = await service.buildWorkspaceBatch('tenant-1', 'workflow-1', {
      afterCursor: 'workflow-operations:119',
      liveConsoleHeadCursor: '2026-03-27T22:46:00.000Z|console-1',
      historyHeadCursor: '2026-03-27T22:46:00.000Z|history-1',
      deliverablesHeadCursor: '2026-03-27T22:47:00.000Z|deliverable-1',
    });

    expect(result.cursor).toBe('workflow-operations:120');
    expect(result.surface_cursors).toEqual({
      live_console_head: '2026-03-27T22:46:00.000Z|console-1',
      history_head: '2026-03-27T22:46:00.000Z|history-1',
      deliverables_head: '2026-03-27T22:47:00.000Z|deliverable-1',
    });
    expect(result.events).toEqual([
      expect.objectContaining({ event_type: 'workspace_sticky_update' }),
      expect.objectContaining({ event_type: 'workspace_board_update' }),
      expect.objectContaining({ event_type: 'workspace_tab_counts_update' }),
      expect.objectContaining({ event_type: 'needs_action_replace' }),
      expect.objectContaining({ event_type: 'steering_replace' }),
      expect.objectContaining({
        event_type: 'live_console_append',
        payload: {
          items: [],
          next_cursor: 'console-cursor',
        },
      }),
      expect.objectContaining({
        event_type: 'history_append',
        payload: {
          items: [],
          groups: [],
          next_cursor: 'history-cursor',
        },
      }),
      expect.objectContaining({ event_type: 'inputs_replace' }),
      expect.objectContaining({ event_type: 'redrive_lineage_update' }),
    ]);
  });

  it('emits reset_required when the stream cursor is malformed', async () => {
    const railService = {
      getRail: vi.fn(async () => ({
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        snapshot_version: 'workflow-operations:120',
        mode: 'live',
        rows: [],
        ongoing_rows: [],
        selected_workflow_id: null,
        next_cursor: null,
      })),
    };
    const workspaceService = {
      getWorkspace: vi.fn(),
    };

    const service = new WorkflowOperationsStreamService(
      railService as never,
      workspaceService as never,
    );

    const result = await service.buildRailBatch('tenant-1', {
      mode: 'live',
      afterCursor: 'bad-cursor',
    });

    expect(result.events).toEqual([
      expect.objectContaining({
        event_type: 'reset_required',
        payload: {
          reason: 'cursor_expired',
          recommended_action: 'reload_snapshot',
        },
      }),
    ]);
  });

  it('emits append events when surface heads advance without a snapshot version change', async () => {
    const railService = {
      getRail: vi.fn(),
    };
    const workspaceService = {
      getWorkspace: vi.fn(async () => ({
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        snapshot_version: 'workflow-operations:120',
        workflow_id: 'workflow-1',
        selected_scope: { scope_kind: 'workflow', work_item_id: null },
        sticky_strip: { workflow_id: 'workflow-1' },
        board: { lanes: [] },
        bottom_tabs: {
          default_tab: 'live_console',
          current_scope_kind: 'workflow',
          current_work_item_id: null,
          counts: {
            needs_action: 0,
            steering: 0,
            live_console_activity: 2,
            history: 1,
            deliverables: 0,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { quick_actions: [], decision_actions: [], recent_interventions: [], session: null },
        live_console: {
          generated_at: '2026-03-27T22:45:00.000Z',
          latest_event_id: 120,
          snapshot_version: 'workflow-operations:120',
          items: [
            { item_id: 'console-2', created_at: '2026-03-27T22:47:00.000Z' },
            { item_id: 'console-1', created_at: '2026-03-27T22:46:00.000Z' },
          ],
          next_cursor: 'console-cursor',
          live_visibility_mode: 'enhanced',
        },
        history: {
          generated_at: '2026-03-27T22:45:00.000Z',
          latest_event_id: 120,
          snapshot_version: 'workflow-operations:120',
          groups: [],
          items: [],
          filters: { available: [], active: [] },
          next_cursor: 'history-cursor',
        },
        deliverables: {
          final_deliverables: [],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: 'deliverables-cursor',
        },
        redrive_lineage: null,
      })),
    };

    const service = new WorkflowOperationsStreamService(
      railService as never,
      workspaceService as never,
    );

    const result = await service.buildWorkspaceBatch('tenant-1', 'workflow-1', {
      afterCursor: 'workflow-operations:120',
      liveConsoleHeadCursor: '2026-03-27T22:46:00.000Z|console-1',
      historyHeadCursor: null,
      deliverablesHeadCursor: null,
    });

    expect(result.events).toEqual([
      expect.objectContaining({
        event_type: 'live_console_append',
        payload: {
          items: [{ item_id: 'console-2', created_at: '2026-03-27T22:47:00.000Z' }],
          next_cursor: 'console-cursor',
        },
      }),
    ]);
  });
});
