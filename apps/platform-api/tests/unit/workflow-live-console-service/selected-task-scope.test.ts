import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('supports selected task scope without a work item id for orchestrator execution turns', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async () => ({
        data: [
          {
            id: 'log-orchestrator',
            source: 'runtime',
            category: 'agent_loop',
            level: 'debug',
            operation: 'agent.act',
            status: 'completed',
            payload: {
              tool: 'create_task',
              input: {
                title: 'Assess intake triage readiness',
              },
            },
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            work_item_id: null,
            task_id: 'task-orchestrator',
            stage_name: 'triage',
            is_orchestrator_task: true,
            task_title: 'Orchestrate intake workflow',
            role: 'orchestrator',
            actor_type: 'worker',
            actor_name: 'Orchestrator',
            resource_name: null,
            created_at: '2026-03-28T07:59:00.000Z',
          },
        ],
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

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      taskId: 'task-orchestrator',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-orchestrator',
        item_kind: 'execution_turn',
        work_item_id: null,
        task_id: 'task-orchestrator',
        scope_binding: 'execution_context',
      }),
    ]);
    expect(result.total_count).toBe(1);
  });

  it('excludes orchestrator execution turns that target a sibling work item from selected work-item scope', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async () => ({
        data: [
          {
            id: 'log-sibling',
            source: 'runtime',
            category: 'agent_loop',
            level: 'debug',
            operation: 'agent.act',
            status: 'completed',
            payload: {
              tool: 'create_task',
              input: {
                title: 'Triage workflows-intake-02',
                work_item_id: 'work-item-2',
              },
            },
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            work_item_id: 'work-item-1',
            task_id: 'orchestrator-task-1',
            stage_name: 'triage',
            is_orchestrator_task: true,
            task_title: 'Orchestrate intake workflow',
            role: 'orchestrator',
            actor_type: 'worker',
            actor_name: 'Orchestrator',
            resource_name: null,
            created_at: '2026-03-28T07:58:30.000Z',
          },
          {
            id: 'log-same-item-execution-context',
            source: 'runtime',
            category: 'agent_loop',
            level: 'debug',
            operation: 'agent.plan',
            status: 'completed',
            payload: {
              headline: 'Confirm the selected work item is ready before routing implementation.',
            },
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            work_item_id: 'work-item-1',
            task_id: 'orchestrator-task-1',
            stage_name: 'triage',
            is_orchestrator_task: true,
            task_title: 'Orchestrate intake workflow',
            role: 'orchestrator',
            actor_type: 'worker',
            actor_name: 'Orchestrator',
            resource_name: null,
            created_at: '2026-03-28T07:58:45.000Z',
          },
          {
            id: 'log-selected',
            source: 'runtime',
            category: 'agent_loop',
            level: 'debug',
            operation: 'agent.act',
            status: 'completed',
            payload: {
              tool: 'create_task',
              input: {
                title: 'Assess workflows-intake-01 triage readiness',
                work_item_id: 'work-item-1',
              },
            },
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            work_item_id: 'work-item-1',
            task_id: 'orchestrator-task-1',
            stage_name: 'triage',
            is_orchestrator_task: true,
            task_title: 'Orchestrate intake workflow',
            role: 'orchestrator',
            actor_type: 'worker',
            actor_name: 'Orchestrator',
            resource_name: null,
            created_at: '2026-03-28T07:59:00.000Z',
          },
        ],
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

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-selected',
        headline: '[Act] Creating a task: Assess workflows-intake-01 triage readiness',
      }),
      expect.objectContaining({
        item_id: 'execution-log:log-same-item-execution-context',
        headline: '[Plan] Confirm the selected work item is ready before routing implementation.',
      }),
    ]);
    expect(result.total_count).toBe(2);
  });

  it('includes linked-target execution turns from predecessor tasks in selected work-item scope', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
      workflowBoardSource: unknown,
    ) => WorkflowLiveConsoleService;
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
              id: 'log-predecessor-linked-target',
              source: 'runtime',
              category: 'agent_loop',
              level: 'debug',
              operation: 'agent.act',
              status: 'completed',
              payload: {
                tool: 'create_task',
                input: {
                  title: 'Package approved assess-command release evidence',
                  work_item_id: 'work-item-2',
                },
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: 'work-item-1',
              task_id: 'task-acceptance',
              stage_name: 'implementation',
              is_orchestrator_task: false,
              task_title: 'Approve assess command implementation',
              role: 'approve-acceptance-assessor',
              actor_type: 'runtime',
              actor_name: 'Acceptance Assessor',
              resource_name: null,
              created_at: '2026-03-28T08:00:30.000Z',
            },
            {
              id: 'log-orchestrator-linked-target',
              source: 'runtime',
              category: 'agent_loop',
              level: 'debug',
              operation: 'agent.act',
              status: 'completed',
              payload: {
                tool: 'submit_handoff',
                phase: 'act',
                input: {
                  summary:
                    'Queued events confirmed the implementation work item is fully complete for revision 1 and the release-readiness successor is now active.',
                  completion: 'full',
                  recommended_next_actions: [
                    {
                      target_type: 'work_item',
                      target_id: 'work-item-2',
                      action_code: 'proceed_release_packaging',
                      requires_orchestrator_judgment: true,
                      why:
                        'Implementation is accepted and assessed, so the remaining workflow work is release-readiness packaging.',
                    },
                  ],
                },
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: 'work-item-1',
              task_id: 'task-orchestrator',
              stage_name: 'implementation',
              is_orchestrator_task: true,
              task_title: 'Orchestrate workflow',
              role: 'orchestrator',
              actor_type: 'worker',
              actor_name: 'Orchestrator',
              resource_name: null,
              created_at: '2026-03-28T08:00:45.000Z',
            },
            {
              id: 'log-current-item',
              source: 'runtime',
              category: 'agent_loop',
              level: 'debug',
              operation: 'agent.plan',
              status: 'completed',
              payload: {
                headline: 'Prepare the release-readiness package for the selected work item.',
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: 'work-item-2',
              task_id: 'task-release',
              stage_name: 'release-readiness',
              is_orchestrator_task: false,
              task_title: 'Package approved assess-command release evidence',
              role: 'approve-release-coordinator',
              actor_type: 'runtime',
              actor_name: 'Release Coordinator',
              resource_name: null,
              created_at: '2026-03-28T08:01:00.000Z',
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
          work_items: [{ id: 'work-item-1' }, { id: 'work-item-2' }],
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-2',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-current-item',
        task_id: 'task-release',
        work_item_id: 'work-item-2',
      }),
      expect.objectContaining({
        item_id: 'execution-log:log-orchestrator-linked-target',
        task_id: 'task-orchestrator',
        work_item_id: 'work-item-2',
      }),
      expect.objectContaining({
        item_id: 'execution-log:log-predecessor-linked-target',
        task_id: 'task-acceptance',
        work_item_id: 'work-item-2',
      }),
    ]);
    expect(result.total_count).toBe(3);
  });

});
