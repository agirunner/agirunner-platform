import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('reports the full live-console total even when pagination trims the current page', async () => {
    const updates = Array.from({ length: 12 }, (_, index) => ({
      id: `update-${index + 1}`,
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      task_id: null,
      request_id: `update-request-${index + 1}`,
      execution_context_id: 'activation-1',
      source_kind: 'orchestrator',
      source_role_name: 'Orchestrator',
      update_kind: 'turn_update',
      headline: `Update ${index + 1}`,
      summary: `Summary ${index + 1}`,
      linked_target_ids: ['workflow-1', 'work-item-1'],
      visibility_mode: 'enhanced',
      promoted_brief_id: null,
      sequence_number: 12 - index,
      created_by_type: 'agent',
      created_by_id: 'agent-1',
      created_at: `2026-03-28T08:${String(index).padStart(2, '0')}:00.000Z`,
    }));
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
        listUpdates: vi.fn(async () => updates),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', { limit: 5 });

    expect(result.total_count).toBe(12);
    expect(result.items).toHaveLength(5);
    expect(result.next_cursor).not.toBeNull();
  });

  it('includes execution-turn items from execution logs when enhanced live visibility is enabled', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      updateSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async () => ({
        data: [
          {
            id: 'log-1',
            source: 'runtime',
            category: 'agent_loop',
            level: 'debug',
            operation: 'agent.plan',
            status: 'completed',
            payload: {
              summary: 'Drafting the policy assessment handoff.',
            },
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            stage_name: 'review',
            is_orchestrator_task: false,
            task_title: 'Assess policy readiness',
            role: 'policy-assessor',
            actor_type: 'runtime',
            actor_name: 'Policy Assessor',
            resource_name: null,
            created_at: '2026-03-28T07:58:30.000Z',
          },
        ],
        pagination: {
          per_page: 10,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      })),
    };
    const service = new ServiceCtor(
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
      executionTurnSource as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(executionTurnSource.query).toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({
        item_kind: 'execution_turn',
        item_id: 'execution-log:log-1',
        source_label: 'Policy Assessor',
        headline: 'Drafting the policy assessment handoff.',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
      }),
    ]);
    expect(result.total_count).toBe(1);
  });

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
    expect(result.total_count).toBe(2);
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
    expect(result.total_count).toBe(0);
  });

  it('preserves persisted brief target ids instead of rebuilding them from nullable columns', async () => {
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
            work_item_id: null,
            task_id: null,
            request_id: 'brief-request',
            execution_context_id: 'activation-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            status_kind: 'in_progress',
            short_brief: { headline: 'Replan requested' },
            detailed_brief_json: {
              headline: 'Replan requested',
              status_kind: 'in_progress',
              summary: 'An operator requested replan guidance.',
            },
            linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
            sequence_number: 5,
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
        listUpdates: vi.fn(async () => []),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-1',
        work_item_id: null,
        task_id: null,
        linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
      }),
    ]);
    expect(result.total_count).toBe(1);
  });

  it('exposes explicit work-item and task ids for live-console entries', async () => {
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
            work_item_id: 'work-item-44',
            task_id: 'task-11',
            request_id: 'brief-request',
            execution_context_id: 'task-11',
            brief_kind: 'milestone',
            brief_scope: 'work_item_handoff',
            source_kind: 'specialist',
            source_role_name: 'Policy Assessor',
            status_kind: 'in_progress',
            short_brief: { headline: 'Policy review requested changes' },
            detailed_brief_json: {
              headline: 'Policy review requested changes',
              status_kind: 'in_progress',
              summary: 'Revision 2 still needs controls.',
            },
            linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
            sequence_number: 6,
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
            work_item_id: 'work-item-44',
            task_id: 'task-11',
            request_id: 'update-request',
            execution_context_id: 'task-11',
            source_kind: 'specialist',
            source_role_name: 'Policy Assessor',
            update_kind: 'turn_update',
            headline: 'Reviewing owner handoff detail.',
            summary: 'Owner handoff detail is still missing.',
            linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 7,
            created_by_type: 'agent',
            created_by_id: 'agent-1',
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
      workItemId: 'work-item-44',
      taskId: 'task-11',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'update-1',
        work_item_id: 'work-item-44',
        task_id: 'task-11',
      }),
      expect.objectContaining({
        item_id: 'brief-1',
        work_item_id: 'work-item-44',
        task_id: 'task-11',
      }),
    ]);
    expect(result.total_count).toBe(2);
  });
});
