import { describe, expect, it, vi } from 'vitest';

import { WorkflowLiveConsoleService } from '../../src/services/workflow-operations/workflow-live-console-service.js';

describe('WorkflowLiveConsoleService', () => {
  it('composes milestone briefs and operator updates into the live console stream with cursors', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Release package is ready for approval.' },
          detailed_brief_json: {
            headline: 'Release package is ready for approval.',
            status_kind: 'in_progress',
            summary: 'Verification completed and release is waiting on approval.',
          },
          sequence_number: 7,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const updateService = {
      listUpdates: vi.fn(async () => [
        {
          id: 'update-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-2',
          execution_context_id: 'execution-2',
          source_kind: 'platform',
          source_role_name: 'Platform',
          update_kind: 'platform_notice',
          headline: 'Approval is now required.',
          summary: 'Open the workflow and respond in Needs Action.',
          linked_target_ids: ['workflow-1'],
          visibility_mode: 'standard',
          promoted_brief_id: null,
          sequence_number: 9,
          created_by_type: 'system',
          created_by_id: 'platform',
          created_at: '2026-03-27T22:36:00.000Z',
        },
        {
          id: 'update-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          update_kind: 'turn_update',
          headline: 'Verification is reviewing rollback handling.',
          summary: 'Verification is in progress.',
          linked_target_ids: ['work-item-1'],
          visibility_mode: 'enhanced',
          promoted_brief_id: null,
          sequence_number: 8,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const logService = {
      listLogs: vi.fn(async () => ({
        data: [],
        pagination: {
          per_page: 0,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      logService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );
    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:101',
        items: [
          expect.objectContaining({
            item_id: 'update-2',
            item_kind: 'platform_notice',
            headline: 'Approval is now required.',
            source_kind: 'platform',
            source_label: 'Platform',
          }),
          expect.objectContaining({
            item_id: 'brief-1',
            item_kind: 'milestone_brief',
            headline: 'Release package is ready for approval.',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
          }),
        ],
        next_cursor: '2026-03-27T22:35:00.000Z|brief-1',
      }),
    );
  });

  it('filters older console items when an after cursor is supplied', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Newest brief' },
          detailed_brief_json: { headline: 'Newest brief', status_kind: 'in_progress' },
          sequence_number: 2,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const updateService = {
      listUpdates: vi.fn(async () => [
        {
          id: 'update-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          update_kind: 'turn_update',
          headline: 'Older update',
          summary: 'Still in progress.',
          linked_target_ids: ['work-item-1'],
          visibility_mode: 'enhanced',
          promoted_brief_id: null,
          sequence_number: 1,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const logService = {
      listLogs: vi.fn(async () => ({
        data: [],
        pagination: {
          per_page: 0,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      logService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
      after: '2026-03-27T22:35:00.000Z|brief-1',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'update-1',
        headline: 'Older update',
      }),
    ]);
  });

  it('reports the effective visibility mode even before any operator updates exist', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const logService = {
      listLogs: vi.fn(async () => ({
        data: [],
        pagination: {
          per_page: 0,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      })),
    };
    const settingsSource = {
      getWorkflowSettings: vi.fn(async () => ({
        effective_live_visibility_mode: 'enhanced',
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      logService as never,
      settingsSource as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
    });

    expect(result.live_visibility_mode).toBe('enhanced');
    expect(settingsSource.getWorkflowSettings).toHaveBeenCalledWith('tenant-1', 'workflow-1');
  });

  it('includes newest-first execution turn items composed from agent loop logs', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const logService = {
      listLogs: vi.fn(async () => ({
        data: [
          {
            id: '520',
            tenant_id: 'tenant-1',
            trace_id: 'trace-1',
            span_id: 'span-1',
            parent_span_id: null,
            source: 'runtime',
            category: 'agent_loop',
            level: 'info',
            operation: 'agent.observe',
            status: 'completed',
            duration_ms: 20,
            payload: {
              summary: 'Observed the updated repository state.',
              text_preview: 'Observed diff and validation output.',
              iteration: 2,
            },
            error: null,
            workspace_id: 'workspace-1',
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            workspace_name: 'Workspace 1',
            task_id: 'task-1',
            work_item_id: 'work-item-1',
            stage_name: 'drafting',
            activation_id: 'activation-1',
            is_orchestrator_task: false,
            execution_backend: 'runtime_plus_task',
            tool_owner: 'task',
            task_title: 'Review draft',
            role: 'reviewer',
            actor_type: 'worker',
            actor_id: 'worker-1',
            actor_name: 'Reviewer agent',
            resource_type: null,
            resource_id: null,
            resource_name: null,
            execution_environment_id: null,
            execution_environment_name: null,
            execution_environment_image: null,
            execution_environment_distro: null,
            execution_environment_package_manager: null,
            created_at: '2026-03-27T22:36:00.000Z',
          },
          {
            id: '519',
            tenant_id: 'tenant-1',
            trace_id: 'trace-1',
            span_id: 'span-2',
            parent_span_id: null,
            source: 'runtime',
            category: 'agent_loop',
            level: 'info',
            operation: 'agent.plan',
            status: 'completed',
            duration_ms: 18,
            payload: {
              summary: 'Plan the next validation steps.',
              steps: [{ description: 'Review rollback handling' }],
              iteration: 1,
            },
            error: null,
            workspace_id: 'workspace-1',
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow 1',
            workspace_name: 'Workspace 1',
            task_id: 'task-1',
            work_item_id: 'work-item-1',
            stage_name: 'drafting',
            activation_id: 'activation-1',
            is_orchestrator_task: false,
            execution_backend: 'runtime_plus_task',
            tool_owner: 'task',
            task_title: 'Review draft',
            role: 'reviewer',
            actor_type: 'worker',
            actor_id: 'worker-1',
            actor_name: 'Reviewer agent',
            resource_type: null,
            resource_id: null,
            resource_name: null,
            execution_environment_id: null,
            execution_environment_name: null,
            execution_environment_image: null,
            execution_environment_distro: null,
            execution_environment_package_manager: null,
            created_at: '2026-03-27T22:35:30.000Z',
          },
        ],
        pagination: {
          per_page: 2,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      briefService as never,
      updateService as never,
      logService as never,
      {
        getWorkflowSettings: vi.fn(async () => ({
          effective_live_visibility_mode: 'enhanced',
        })),
      } as never,
    );

    const result = await service.getLiveConsole('tenant-1', 'workflow-1', {
      limit: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:520',
        item_kind: 'execution_turn',
        source_kind: 'reviewer',
        source_label: 'Reviewer',
        headline: 'Observed the updated repository state.',
      }),
      expect.objectContaining({
        item_id: 'execution-log:519',
        item_kind: 'execution_turn',
        headline: 'Plan the next validation steps.',
      }),
    ]);
    expect(logService.listLogs).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      workItemId: undefined,
      category: ['agent_loop'],
      operation: ['agent.think', 'agent.plan', 'agent.act', 'agent.observe', 'agent.verify'],
      order: 'desc',
      perPage: 500,
    });
  });

  it('normalizes execution log timestamps before sorting live console items', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:35:00.000Z',
          latestEventId: 101,
          token: 'mission-control:101',
        },
        packets: [],
      })),
    };

    const service = new WorkflowLiveConsoleService(
      versionSource as never,
      { listBriefs: vi.fn(async () => []) } as never,
      { listUpdates: vi.fn(async () => []) } as never,
      {
        listLogs: vi.fn(async () => ({
          data: [
            {
              id: '521',
              tenant_id: 'tenant-1',
              trace_id: 'trace-1',
              span_id: 'span-1',
              parent_span_id: null,
              source: 'runtime',
              category: 'agent_loop',
              level: 'info',
              operation: 'agent.observe',
              status: 'completed',
              duration_ms: null,
              payload: {
                summary: 'Observed repository output.',
              },
              error: null,
              workspace_id: 'workspace-1',
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              workspace_name: 'Workspace 1',
              task_id: 'task-1',
              work_item_id: 'work-item-1',
              stage_name: 'drafting',
              activation_id: 'activation-1',
              is_orchestrator_task: false,
              execution_backend: 'runtime_plus_task',
              tool_owner: 'task',
              task_title: 'Review draft',
              role: 'reviewer',
              actor_type: 'worker',
              actor_id: 'worker-1',
              actor_name: 'Reviewer agent',
              resource_type: null,
              resource_id: null,
              resource_name: null,
              execution_environment_id: null,
              execution_environment_name: null,
              execution_environment_image: null,
              execution_environment_distro: null,
              execution_environment_package_manager: null,
              created_at: new Date('2026-03-27T22:36:30.000Z'),
            } as never,
          ],
          pagination: {
            per_page: 1,
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
          },
        })),
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
        item_id: 'execution-log:521',
        item_kind: 'execution_turn',
        created_at: '2026-03-27T22:36:30.000Z',
      }),
    ]);
  });
});
