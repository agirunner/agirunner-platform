import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('merges execution-turn fallbacks with operator updates and briefs when updates exist', async () => {
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
      {
        query: vi.fn(async (_tenantId, filters) => {
          expect(filters.workflowId).toBe('workflow-1');
          expect(filters.workItemId).toBe('work-item-1');
          expect(filters.taskId).toBe('task-1');
          expect(filters.category).toEqual(['agent_loop']);
          return {
            data: [
              {
                id: 'log-1',
                tenant_id: 'tenant-1',
                trace_id: 'trace-1',
                span_id: 'span-1',
                parent_span_id: null,
                source: 'runtime',
                category: 'agent_loop',
                level: 'info',
                operation: 'agent.observe',
                status: 'completed',
                duration_ms: 100,
                payload: { summary: 'Observed that verification completed successfully.' },
                error: null,
                workspace_id: 'workspace-1',
                workflow_id: 'workflow-1',
                workflow_name: 'Workflow',
                workspace_name: 'Workspace',
                task_id: 'task-1',
                work_item_id: 'work-item-1',
                stage_name: 'review',
                activation_id: 'activation-1',
                is_orchestrator_task: false,
                execution_backend: 'runtime_plus_task',
                tool_owner: 'task',
                task_title: 'Verify rollback handling',
                role: 'verifier',
                actor_type: 'agent',
                actor_id: 'agent-2',
                actor_name: 'Verifier',
                resource_type: null,
                resource_id: null,
                resource_name: null,
                execution_environment_id: null,
                execution_environment_name: null,
                execution_environment_image: null,
                execution_environment_distro: null,
                execution_environment_package_manager: null,
                created_at: '2026-03-28T08:00:00.000Z',
              },
            ],
          };
        }),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(result.snapshot_version).toBe('workflow-operations:77');
    expect(result.items.map((item) => item.item_id)).toEqual([
      'execution-log:log-1',
      'update-1',
      'brief-1',
    ]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        item_kind: 'execution_turn',
        headline: 'Checking results for Verify rollback handling',
        summary: 'Observed that verification completed successfully.',
        source_label: 'Verifier',
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        item_kind: 'operator_update',
        headline: 'Verifier is checking rollback handling.',
        source_label: 'Verifier',
      }),
    );
  });

  it('uses a safe generic fallback when no operator updates exist', async () => {
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
      {
        query: vi.fn(async () => ({
          data: [
            {
              id: 'log-1',
              tenant_id: 'tenant-1',
              trace_id: 'trace-1',
              span_id: 'span-1',
              parent_span_id: null,
              source: 'runtime',
              category: 'agent_loop',
              level: 'info',
              operation: 'agent.act',
              status: 'completed',
              duration_ms: 100,
              payload: { tool: 'file_read' },
              error: null,
              workspace_id: 'workspace-1',
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow',
              workspace_name: 'Workspace',
              task_id: 'task-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: 'activation-1',
              is_orchestrator_task: false,
              execution_backend: 'runtime_plus_task',
              tool_owner: 'task',
              task_title: 'Verify rollback handling',
              role: 'verifier',
              actor_type: 'agent',
              actor_id: 'agent-2',
              actor_name: 'Verifier',
              resource_type: null,
              resource_id: null,
              resource_name: null,
              execution_environment_id: null,
              execution_environment_name: null,
              execution_environment_image: null,
              execution_environment_distro: null,
              execution_environment_package_manager: null,
              created_at: '2026-03-28T08:00:00.000Z',
            },
          ],
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-1',
        item_kind: 'execution_turn',
        headline: 'Working through Verify rollback handling',
        summary: 'Execution turn completed for Verify rollback handling.',
        source_label: 'Verifier',
      }),
    ]);
  });
});
