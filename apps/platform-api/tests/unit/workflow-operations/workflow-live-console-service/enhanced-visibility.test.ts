import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('queries the full meaningful agent-loop phase set for enhanced live visibility', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return { data: [], pagination: { per_page: 10, has_more: false, next_cursor: null, prev_cursor: null } };
        }
        return {
          data: [
            {
              id: 'plan-1',
              source: 'runtime',
              category: 'agent_loop',
              level: 'info',
              operation: 'agent.plan',
              status: 'completed',
              payload: {
                phase: 'plan',
                llm_turn_count: 3,
                plan_summary: 'Review the current evidence before writing the handoff.',
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
              created_at: '2026-03-28T07:58:10.000Z',
            },
            {
              id: 'observe-1',
              source: 'runtime',
              category: 'agent_loop',
              level: 'info',
              operation: 'agent.observe',
              status: 'completed',
              payload: {
                phase: 'observe',
                llm_turn_count: 4,
                summary: 'The policy review is still waiting on the latest implementation handoff.',
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
              created_at: '2026-03-28T07:58:20.000Z',
            },
            {
              id: 'verify-1',
              source: 'runtime',
              category: 'agent_loop',
              level: 'info',
              operation: 'agent.verify',
              status: 'completed',
              payload: {
                phase: 'verify',
                status: 'blocked',
                summary: 'The latest handoff is still pending validation.',
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

    expect(executionTurnSource.query).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        category: ['agent_loop', 'task_lifecycle'],
        operation: [
          'agent.think',
          'agent.plan',
          'agent.act',
          'agent.observe',
          'agent.verify',
          'runtime.loop.think',
          'runtime.loop.plan',
          'runtime.loop.observe',
          'runtime.loop.verify',
        ],
      }),
    );
    expect(result.items.map((item) => item.headline)).toEqual([
      '[Verify] The latest handoff is still pending validation.',
      '[Observe] The policy review is still waiting on the latest implementation handoff.',
      '[Plan] Review the current evidence before writing the brief.',
    ]);
  });

  it('includes runtime loop rows recorded under task_lifecycle in enhanced mode', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return { data: [] };
        }
        if (!filters.category.includes('task_lifecycle')) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: 'runtime-loop-plan-1',
              source: 'runtime',
              category: 'task_lifecycle',
              level: 'info',
              operation: 'runtime.loop.plan',
              status: 'completed',
              payload: {
                burst_id: 2,
                plan_summary: 'Route the next ready review item to the policy assessor.',
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
              created_at: '2026-03-28T07:58:25.000Z',
            },
          ],
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

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:runtime-loop-plan-1',
        headline: '[Plan] Route the next ready review item to the policy assessor.',
      }),
    ]);
    expect(executionTurnSource.query).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        category: expect.arrayContaining(['agent_loop', 'task_lifecycle']),
        operation: expect.arrayContaining(['runtime.loop.plan']),
      }),
    );
  });

  it('keeps payload-attributed execution rows when selected scope would otherwise overfilter the raw query', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (!filters.category.includes('llm')) {
          return { data: [] };
        }
        if (filters.workItemId || filters.taskId) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: 'payload-scoped-log-1',
              source: 'runtime',
              category: 'llm',
              level: 'info',
              operation: 'llm.chat_stream',
              status: 'completed',
              payload: {
                phase: 'act',
                llm_turn_count: 7,
                response_tool_calls: [
                  {
                    name: 'submit_handoff',
                    input: {
                      work_item_id: 'work-item-1',
                      task_id: 'task-1',
                      summary: 'Submitted the specialist handoff for the selected task.',
                      completion: 'full',
                    },
                  },
                ],
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: null,
              task_id: 'orchestrator-task-1',
              stage_name: 'review',
              is_orchestrator_task: true,
              task_title: 'Orchestrate workflow',
              role: 'orchestrator',
              actor_type: 'runtime',
              actor_name: 'Orchestrator',
              resource_name: null,
              created_at: '2026-03-28T07:59:45.000Z',
            },
          ],
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

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:payload-scoped-log-1',
        source_label: 'Orchestrator',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        scope_binding: 'structured_target',
      }),
    ]);
  });

  it('keeps orchestrator execution rows that target the selected task even when their raw task id differs', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (!filters.category.includes('llm')) {
          return { data: [] };
        }
        if (filters.taskId) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: 'orchestrator-log-1',
              source: 'runtime',
              category: 'llm',
              level: 'info',
              operation: 'llm.chat_stream',
              status: 'completed',
              payload: {
                phase: 'act',
                llm_turn_count: 4,
                response_tool_calls: [
                  {
                    name: 'submit_handoff',
                    input: {
                      work_item_id: 'work-item-1',
                      task_id: 'task-1',
                      summary: 'Verified the queued task and submitted the orchestrator handoff.',
                      completion: 'full',
                    },
                  },
                ],
              },
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              work_item_id: 'work-item-1',
              task_id: 'orchestrator-task-1',
              stage_name: 'review',
              is_orchestrator_task: true,
              task_title: 'Orchestrate workflow',
              role: 'orchestrator',
              actor_type: 'runtime',
              actor_name: 'Orchestrator',
              resource_name: null,
              created_at: '2026-03-28T07:59:30.000Z',
            },
          ],
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

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:orchestrator-log-1',
        source_label: 'Orchestrator',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        scope_binding: 'structured_target',
      }),
    ]);
    expect(result.total_count).toBe(1);
  });

});
