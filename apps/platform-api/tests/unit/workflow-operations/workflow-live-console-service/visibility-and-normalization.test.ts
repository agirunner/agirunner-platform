import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('normalizes Date-backed execution timestamps before sorting enhanced live-console rows', async () => {
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

  it('stays limited to scope-backed briefs when no enhanced execution turns survive normalization', async () => {
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

});
