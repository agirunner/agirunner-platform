import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('prefers operator updates over execution-turn fallbacks when updates exist', async () => {
    const service = new WorkflowLiveConsoleService(
      {
        getHistory: vi.fn(async () => ({
          version: {
            generatedAt: '2026-03-28T08:00:00.000Z',
            latestEventId: 77,
            token: 'mission-control:77',
          },
          packets: [],
        })),
      } as never,
      {
        listBriefs: vi.fn(async () => [
          {
            id: 'brief-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: null,
            request_id: 'brief-request',
            execution_context_id: 'activation-1',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            status_kind: 'in_progress',
            short_brief: { headline: 'Approval brief published' },
            detailed_brief_json: {
              headline: 'Approval brief published',
              status_kind: 'in_progress',
              summary: 'Approval is now required.',
            },
            linked_target_ids: ['workflow-1', 'work-item-1'],
            sequence_number: 3,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'agent',
            created_by_id: 'agent-1',
            created_at: '2026-03-28T07:58:00.000Z',
            updated_at: '2026-03-28T07:58:00.000Z',
          },
        ]),
      } as never,
      {
        listUpdates: vi.fn(async () => [
          {
            id: 'update-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'update-request',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            update_kind: 'turn_update',
            headline: 'Verifier is checking rollback handling.',
            summary: 'Rollback handling is under review.',
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 4,
            created_by_type: 'agent',
            created_by_id: 'agent-2',
            created_at: '2026-03-28T07:59:00.000Z',
          },
        ]),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(result.snapshot_version).toBe('workflow-operations:77');
    expect(result.items.map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
    ]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        item_kind: 'operator_update',
        headline: 'Verifier is checking rollback handling.',
        summary: 'Rollback handling is under review.',
        source_label: 'Verifier',
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        item_kind: 'milestone_brief',
        headline: 'Approval brief published',
        source_label: 'Orchestrator',
      }),
    );
  });

  it('stays empty until operator headlines or briefs exist', async () => {
    const service = new WorkflowLiveConsoleService(
      {
        getHistory: vi.fn(async () => ({
          version: {
            generatedAt: '2026-03-28T08:00:00.000Z',
            latestEventId: 77,
            token: 'mission-control:77',
          },
          packets: [],
        })),
      } as never,
      {
        listBriefs: vi.fn(async () => []),
      } as never,
      {
        listUpdates: vi.fn(async () => []),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(result.items).toEqual([]);
  });
});
