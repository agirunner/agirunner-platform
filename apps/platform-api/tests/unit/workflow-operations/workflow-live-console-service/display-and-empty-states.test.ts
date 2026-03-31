import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
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

  it('suppresses raw JSON execution turns that do not resolve to operator-readable text', async () => {
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return {
            data: [
              {
                id: 'log-raw-json',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'act',
                  response_text: '{"foo":"bar","count":2}',
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
          };
        }
        return {
          data: [],
        };
      }),
    };
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

    expect(result.items).toEqual([]);
    expect(result.total_count).toBe(0);
    expect(result.counts).toEqual({
      all: 0,
      turn_updates: 0,
      briefs: 0,
      steering: 0,
    });
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
                  phase: 'act',
                  response_tool_calls: [
                    {
                      name: 'submit_handoff',
                      input: {
                        summary: 'Owner handoff detail is still missing.',
                        completion: 'full',
                      },
                    },
                  ],
                },
                workflow_id: 'workflow-1',
                workflow_name: 'Workflow 1',
                work_item_id: 'work-item-44',
                task_id: 'task-11',
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
          };
        }
        return {
          data: [],
        };
      }),
    };
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
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
      executionTurnSource as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-44',
      taskId: 'task-11',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-1',
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
