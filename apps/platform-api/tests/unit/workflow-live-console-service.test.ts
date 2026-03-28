import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('composes milestone briefs and operator updates into the live console stream with cursors', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Release package is ready for approval.' },
          detailed_brief_json: {
            headline: 'Release package is ready for approval.',
            status_kind: 'in_progress',
            summary: 'Verification completed and release is waiting on approval.',
          },
          sequence_number: 7,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const updateService = {
      listUpdates: vi.fn(async () => [
        {
          id: 'update-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-2',
          execution_context_id: 'execution-2',
          source_kind: 'platform',
          source_role_name: 'Platform',
          update_kind: 'platform_notice',
          headline: 'Approval is now required.',
          summary: 'Open the workflow and respond in Needs Action.',
          linked_target_ids: ['workflow-1'],
          visibility_mode: 'standard',
          promoted_brief_id: null,
          sequence_number: 9,
          created_by_type: 'system',
          created_by_id: 'platform',
          created_at: '2026-03-27T22:36:00.000Z',
        },
        {
          id: 'update-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          update_kind: 'turn_update',
          headline: 'Verification is reviewing rollback handling.',
          summary: 'Verification is in progress.',
          linked_target_ids: ['work-item-1'],
          visibility_mode: 'enhanced',
          promoted_brief_id: null,
          sequence_number: 8,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );
    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:101',
        items: [
          expect.objectContaining({
            item_id: 'update-2',
            item_kind: 'platform_notice',
            headline: 'Approval is now required.',
            source_kind: 'platform',
            source_label: 'Platform',
          }),
          expect.objectContaining({
            item_id: 'brief-1',
            item_kind: 'milestone_brief',
            headline: 'Release package is ready for approval.',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
          }),
        ],
        next_cursor: '2026-03-27T22:35:00.000Z|brief-1',
      }),
    );
  });

  it('filters older console items when an after cursor is supplied', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Newest brief' },
          detailed_brief_json: { headline: 'Newest brief', status_kind: 'in_progress' },
          sequence_number: 2,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const updateService = {
      listUpdates: vi.fn(async () => [
        {
          id: 'update-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          update_kind: 'turn_update',
          headline: 'Older update',
          summary: 'Still in progress.',
          linked_target_ids: ['work-item-1'],
          visibility_mode: 'enhanced',
          promoted_brief_id: null,
          sequence_number: 1,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
      after: '2026-03-27T22:35:00.000Z|brief-1',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'update-1',
        headline: 'Older update',
      }),
    ]);
  });

  it('passes task scope through to brief and update sources', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
      workItemId: 'work-item-7',
      taskId: 'task-4',
    });

    expect(briefService.listBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 500,
    });
    expect(updateService.listUpdates).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 500,
    });
  });

  it('reports the effective visibility mode even before any operator updates exist', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const settingsSource = {
      getWorkflowSettings: vi.fn(async () => ({
        effective_live_visibility_mode: 'enhanced',
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      settingsSource as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
    });

    expect(result.live_visibility_mode).toBe('enhanced');
    expect(settingsSource.getWorkflowSettings).toHaveBeenCalledWith('tenant-1', 'workflow-1');
  });

  it('does not leak raw execution-turn logs into the primary live console stream', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
    });

    expect(result.items).toEqual([]);
  });

  it('stays empty when only raw execution logs exist and no operator updates or briefs were recorded', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      { listBriefs: vi.fn(async () => []) } as never,
      { listUpdates: vi.fn(async () => []) } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
  });
});
