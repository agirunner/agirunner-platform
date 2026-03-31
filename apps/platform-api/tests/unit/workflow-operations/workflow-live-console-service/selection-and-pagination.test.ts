import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('reports the full live-console total even when pagination trims the current page', async () => {
    const briefs = Array.from({ length: 12 }, (_, index) => ({
      id: `brief-${index + 1}`,
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      task_id: null,
      request_id: `brief-request-${index + 1}`,
      execution_context_id: 'activation-1',
      brief_kind: 'milestone',
      brief_scope: 'workflow_timeline',
      source_kind: 'specialist',
      source_role_name: 'Orchestrator',
      status_kind: 'in_progress',
      short_brief: { headline: `Brief ${index + 1}` },
      detailed_brief_json: {
        headline: `Brief ${index + 1}`,
        summary: `Summary ${index + 1}`,
        status_kind: 'in_progress',
      },
      linked_target_ids: ['workflow-1', 'work-item-1'],
      sequence_number: 12 - index,
      related_artifact_ids: [],
      related_output_descriptor_ids: [],
      related_intervention_ids: [],
      canonical_workflow_brief_id: null,
      created_by_type: 'agent',
      created_by_id: 'agent-1',
      created_at: `2026-03-28T08:${String(index).padStart(2, '0')}:00.000Z`,
      updated_at: `2026-03-28T08:${String(index).padStart(2, '0')}:00.000Z`,
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
        listBriefs: vi.fn(async () => briefs),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', { limit: 5 });

    expect(result.total_count).toBe(12);
    expect(result.counts).toEqual({
      all: 12,
      turn_updates: 0,
      briefs: 12,
      steering: 0,
    });
    expect(result.items).toHaveLength(5);
    expect(result.next_cursor).not.toBeNull();
  });

  it('keeps linked brief rows in selected work-item scope and counts them with scoped execution turns', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource: unknown,
    ) => WorkflowLiveConsoleService;
    const listBriefs = vi.fn(async (_tenantId, _workflowId, input) => {
      if (input?.workItemId || input?.taskId) {
        return [];
      }
      return [
        {
          id: 'brief-linked',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'brief-request-1',
          execution_context_id: 'activation-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Selected work-item brief' },
          detailed_brief_json: {
            headline: 'Selected work-item brief',
            summary: 'Carry the selected work item forward.',
            status_kind: 'in_progress',
          },
          linked_target_ids: ['workflow-1', 'work-item-1'],
          sequence_number: 2,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'agent',
          created_by_id: 'agent-1',
          created_at: '2026-03-28T07:58:00.000Z',
          updated_at: '2026-03-28T07:58:00.000Z',
        },
      ];
    });
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return {
            data: [
              {
                id: 'log-1',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'plan',
                  response_text: JSON.stringify({
                    summary: 'Continue the selected work item.',
                  }),
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
                created_at: '2026-03-28T07:59:00.000Z',
              },
            ],
            pagination: {
              per_page: 10,
              has_more: false,
              next_cursor: null,
              prev_cursor: null,
            },
          };
        }
        return {
          data: [],
          pagination: {
            per_page: 10,
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
          },
        };
      }),
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
        listBriefs,
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
      executionTurnSource as never,
      {
        getWorkflowBoard: vi.fn(async () => ({
          work_items: [{ id: 'work-item-1' }, { id: 'work-item-2' }],
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 10,
    });

    expect(listBriefs).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        unbounded: true,
        workItemId: undefined,
        taskId: undefined,
      }),
    );
    expect(result.items.map((item) => item.item_id)).toEqual([
      'execution-log:log-1',
      'brief-linked',
    ]);
    expect(result.total_count).toBe(2);
    expect(result.counts).toEqual({
      all: 2,
      turn_updates: 1,
      briefs: 1,
      steering: 0,
    });
  });

  it('keeps task-linked brief rows in selected work-item scope when task bindings come from the workflow task source', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource: unknown,
      taskBindingSource: unknown,
    ) => WorkflowLiveConsoleService;
    const selectedTaskId = '4fcd3b55-450c-4379-80ec-c49ac77d7f27';
    const listBriefs = vi.fn(async (_tenantId, _workflowId, input) => {
      if (input?.workItemId || input?.taskId) {
        return [];
      }
      return [
        {
          id: 'brief-task-linked',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'brief-request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'specialist',
          source_role_name: 'Intake Analyst',
          status_kind: 'handoff',
          short_brief: { headline: 'Overflow queue brief' },
          detailed_brief_json: {
            headline: 'Overflow queue brief',
            summary: 'Task-linked brief for the selected overflow queue work item.',
            status_kind: 'handoff',
          },
          linked_target_ids: ['workflow-1', selectedTaskId],
          sequence_number: 1,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'agent',
          created_by_id: 'agent-1',
          created_at: '2026-03-28T07:58:00.000Z',
          updated_at: '2026-03-28T07:58:00.000Z',
        },
      ];
    });
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
        listBriefs,
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
      undefined,
      {
        getWorkflowBoard: vi.fn(async () => ({
          work_items: [{ id: 'work-item-1' }, { id: 'work-item-2' }],
        })),
      } as never,
      {
        listTasks: vi.fn(async () => ({
          data: [
            {
              id: selectedTaskId,
              work_item_id: 'work-item-1',
            },
          ],
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 10,
    });

    expect(listBriefs).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        unbounded: true,
        workItemId: undefined,
        taskId: undefined,
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-task-linked',
        headline: 'Overflow queue brief',
        linked_target_ids: expect.arrayContaining(['workflow-1', selectedTaskId]),
      }),
    ]);
    expect(result.counts).toEqual({
      all: 1,
      turn_updates: 0,
      briefs: 1,
      steering: 0,
    });
    expect(result.total_count).toBe(1);
  });

  it('includes execution-turn items from execution logs when enhanced live visibility is enabled', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return {
            data: [
              {
                id: 'log-1',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'plan',
                  response_text: JSON.stringify({
                    summary: 'Drafting the policy assessment handoff.',
                  }),
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
          };
        }
        return {
          data: [],
          pagination: {
            per_page: 10,
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
          },
        };
      }),
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

    expect(executionTurnSource.query).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        item_kind: 'execution_turn',
        item_id: 'execution-log:log-1',
        source_label: 'Policy Assessor',
        headline: '[Plan] Drafting the policy assessment brief.',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
      }),
    ]);
    expect(result.total_count).toBe(1);
    expect(result.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
      steering: 0,
    });
  });

});
