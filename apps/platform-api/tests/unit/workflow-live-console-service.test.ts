import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

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
        listUpdates: vi.fn(async () => []),
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
    });
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

    expect(executionTurnSource.query).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        item_kind: 'execution_turn',
        item_id: 'execution-log:log-1',
        source_label: 'Policy Assessor',
        headline: '[Plan] Drafting the policy assessment handoff.',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
      }),
    ]);
    expect(result.total_count).toBe(1);
    expect(result.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
    });
  });

  it('queries the full meaningful agent-loop phase set for enhanced live visibility', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      updateSource: unknown,
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
      '[Plan] Review the current evidence before writing the handoff.',
    ]);
  });

  it('includes runtime loop rows recorded under task_lifecycle in enhanced mode', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      updateSource: unknown,
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
      updateSource: unknown,
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
      updateSource: unknown,
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

  it('normalizes Date-backed execution timestamps before sorting enhanced live-console rows', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      updateSource: unknown,
      visibilityModeSource: unknown,
      executionTurnSource: unknown,
    ) => WorkflowLiveConsoleService;
    const executionTurnSource = {
      query: vi.fn(async (_tenantId, filters) => {
        if (filters.category.includes('llm')) {
          return {
            data: [
              {
                id: 'log-date',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'plan',
                  response_text: JSON.stringify({
                    summary: 'Finish the active release task.',
                  }),
                },
                workflow_id: 'workflow-1',
                workflow_name: 'Workflow 1',
                work_item_id: 'work-item-1',
                task_id: 'task-1',
                stage_name: 'implementation',
                is_orchestrator_task: false,
                task_title: 'Implement release audit',
                role: 'mixed-delivery-engineer',
                actor_type: 'runtime',
                actor_name: 'Mixed Delivery Engineer',
                resource_name: null,
                created_at: new Date('2026-03-28T07:58:30.000Z'),
              },
              {
                id: 'log-string',
                source: 'runtime',
                category: 'llm',
                level: 'info',
                operation: 'llm.chat_stream',
                status: 'completed',
                payload: {
                  phase: 'think',
                  response_text: JSON.stringify({
                    approach: 'Check whether the final release checklist is already complete.',
                  }),
                },
                workflow_id: 'workflow-1',
                workflow_name: 'Workflow 1',
                work_item_id: 'work-item-1',
                task_id: 'task-1',
                stage_name: 'implementation',
                is_orchestrator_task: false,
                task_title: 'Implement release audit',
                role: 'mixed-delivery-engineer',
                actor_type: 'runtime',
                actor_name: 'Mixed Delivery Engineer',
                resource_name: null,
                created_at: '2026-03-28T07:58:00.000Z',
              },
            ],
          };
        }
        return { data: [] };
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
        listUpdates: vi.fn(async () => []),
      } as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
      executionTurnSource as never,
    );

    await expect(
      service.getLiveConsole('tenant-1', 'workflow-1', {
        workItemId: 'work-item-1',
        taskId: 'task-1',
        limit: 10,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        total_count: 2,
        items: expect.arrayContaining([
          expect.objectContaining({
            item_id: 'execution-log:log-date',
            headline: '[Plan] Finish the active release task.',
          }),
          expect.objectContaining({
            item_id: 'execution-log:log-string',
            headline: '[Think] Check whether the final release checklist is already complete.',
          }),
        ]),
      }),
    );
  });

  it('keeps standard live visibility limited to durable records even when execution logs are available', async () => {
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
              summary: 'Route the work item.',
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
      })),
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
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'brief-request',
            execution_context_id: 'task-1',
            brief_kind: 'milestone',
            brief_scope: 'work_item_handoff',
            source_kind: 'specialist',
            source_role_name: 'Policy Assessor',
            status_kind: 'in_progress',
            short_brief: { headline: 'Policy assessment is ready for operator review.' },
            detailed_brief_json: {
              headline: 'Policy assessment is ready for operator review.',
              summary: 'The approval packet is ready.',
              status_kind: 'in_progress',
            },
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
            sequence_number: 4,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'agent',
            created_by_id: 'agent-2',
            created_at: '2026-03-28T07:59:00.000Z',
            updated_at: '2026-03-28T07:59:00.000Z',
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
            source_role_name: 'Policy Assessor',
            update_kind: 'turn_update',
            headline: 'Policy assessment is ready for operator review.',
            summary: 'The approval packet is ready.',
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
            visibility_mode: 'standard',
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
          effective_live_visibility_mode: 'standard',
        })),
      } as never,
      executionTurnSource as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(executionTurnSource.query).not.toHaveBeenCalled();
    expect(result.live_visibility_mode).toBe('standard');
    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-1',
        item_kind: 'milestone_brief',
        headline: 'Policy assessment is ready for operator review.',
      }),
    ]);
  });

  it('ignores deprecated operator updates when briefs already cover the same scope', async () => {
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
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
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
    expect(result.total_count).toBe(1);
    expect(result.items.map((item) => item.item_id)).toEqual(['brief-1']);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        item_kind: 'milestone_brief',
        headline: 'Approval brief published',
        source_label: 'Orchestrator',
      }),
    );
  });

  it('humanizes token-like source role labels for briefs and execution turns', async () => {
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
                    summary: 'Review the current packet before deciding next routing.',
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
                actor_name: 'policy-assessor',
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
            work_item_id: 'work-item-1',
            task_id: null,
            request_id: 'brief-request',
            execution_context_id: 'activation-1',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'orchestrator',
            source_role_name: 'intake-analyst',
            status_kind: 'in_progress',
            short_brief: { headline: 'Approval brief published' },
            detailed_brief_json: {
              headline: 'Approval brief published',
              status_kind: 'in_progress',
              summary: 'Approval is now required.',
            },
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
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

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        source_label: 'Policy Assessor',
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        source_label: 'Intake Analyst',
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

  it('supports selected task scope without a work item id for orchestrator execution turns', async () => {
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
      updateSource: unknown,
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
        listUpdates: vi.fn(async () => []),
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
      updateSource: unknown,
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
        listUpdates: vi.fn(async () => []),
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

  it('passes selected scope filters through to execution-log queries', async () => {
    const ServiceCtor = WorkflowLiveConsoleService as unknown as new (
      versionSource: unknown,
      briefSource: unknown,
      updateSource: unknown,
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
        listUpdates: vi.fn(async () => []),
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
      updateSource: unknown,
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
      limit: 1,
    });

    expect(result.total_count).toBe(2);
    expect(result.counts).toEqual({
      all: 2,
      turn_updates: 2,
      briefs: 0,
    });
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).not.toBeNull();
    expect(executionTurnSource.query).toHaveBeenCalledTimes(3);
  });
});
