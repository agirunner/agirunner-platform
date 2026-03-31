import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('keeps uuid task-target execution turns in selected work-item scope when the board maps that task back to the work item', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource: unknown,
    ) => WorkflowLiveConsoleService;
    const selectedTaskId = '4fcd3b55-450c-4379-80ec-c49ac77d7f27';
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return {
            data: [],
            pagination: {
              has_more: false,
              next_cursor: null,
              prev_cursor: null,
              per_page: 500,
            },
          };
        }
        return {
          data: [
            {
              id: 'log-selected-via-task-target',
              source: 'runtime',
              category: 'agent_loop',
              level: 'debug',
              operation: 'agent.act',
              status: 'completed',
              payload: {
                tool: 'submit_handoff',
                input: {
                  successor_context:
                    'The selected work item can now continue from the predecessor review output.',
                  recommended_next_actions: [
                    {
                      target_type: 'task',
                      target_id: selectedTaskId,
                      action_code: 'continue_selected_work_item',
                    },
                  ],
                },
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: null,
              task_id: null,
              stage_name: 'review',
              is_orchestrator_task: false,
              task_title: 'Submit predecessor handoff',
              role: 'intake-analyst',
              actor_type: 'runtime',
              actor_name: 'Intake Analyst',
              resource_name: null,
              created_at: '2026-03-28T08:00:30.000Z',
            },
          ],
          pagination: {
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
            per_page: 500,
          },
        };
      }),
    };
    const service = new ServiceCtor(
      {
        getHistory: vi.fn(async () => ({
          version: {
            generatedAt: '2026-03-28T08:02:00.000Z',
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
      {
        getWorkflowBoard: vi.fn(async () => ({
          work_items: [
            {
              id: 'work-item-1',
              tasks: [{ id: selectedTaskId }, { id: '9ab5a263-682a-4d1a-bb08-118d8da6b4a5' }],
            },
            {
              id: 'work-item-2',
              tasks: [{ id: 'fba5fd53-d453-4a73-8fef-30aa3452286d' }],
            },
          ],
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-selected-via-task-target',
        linked_target_ids: expect.arrayContaining(['workflow-1', selectedTaskId]),
        scope_binding: 'structured_target',
      }),
    ]);
    expect(result.total_count).toBe(1);
  });

  it('passes selected scope filters through to execution-log queries', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource?: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async () => ({
        data: [],
        pagination: {
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
          per_page: 500,
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
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
      executionTurnSource as never,
    );

    await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(executionTurnSource.query).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      expect.objectContaining({
        workflowId: 'workflow-1',
        workItemId: undefined,
        taskId: undefined,
      }),
    );
    expect(executionTurnSource.query).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      expect.objectContaining({
        workflowId: 'workflow-1',
        workItemId: undefined,
        taskId: undefined,
      }),
    );
  });

  it('aggregates execution-turn rows across log pages before computing totals', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          if (!filters.cursor) {
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
                    response_text: JSON.stringify({ summary: 'First scoped turn.' }),
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
                has_more: true,
                next_cursor: 'cursor-2',
                prev_cursor: null,
                per_page: 1,
              },
            };
          }
          return {
            data: [
              {
                id: 'log-2',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'verify',
                  response_text: JSON.stringify({ summary: 'Second scoped turn.' }),
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
                created_at: '2026-03-28T07:57:30.000Z',
              },
            ],
            pagination: {
              has_more: false,
              next_cursor: null,
              prev_cursor: null,
              per_page: 1,
            },
          };
        }
        return {
          data: [],
          pagination: {
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
            per_page: 1,
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
      limit: 1,
    });

    expect(result.total_count).toBe(2);
    expect(result.counts).toEqual({
      all: 2,
      turn_updates: 2,
      briefs: 0,
      steering: 0,
    });
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).not.toBeNull();
    expect(executionTurnSource.query).toHaveBeenCalledTimes(3);
  });
});
