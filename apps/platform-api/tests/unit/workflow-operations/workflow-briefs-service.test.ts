import { describe, expect, it, vi } from 'vitest';

import { WorkflowBriefsService } from '../../../src/services/workflow-operations/workflow-briefs-service.js';

describe('WorkflowBriefsService', () => {
  it('builds newest-first briefs packets from persisted workflow operator briefs', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:45:00.000Z',
          latestEventId: 120,
        },
        packets: [],
      })),
    };
    const briefSource = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-2',
          execution_context_id: 'execution-2',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          llm_turn_count: 4,
          status_kind: 'handoff',
          short_brief: { headline: 'Release ready' },
          detailed_brief_json: { summary: 'Release is ready for operator review.' },
          linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          sequence_number: 4,
          related_artifact_ids: ['artifact-1'],
          related_output_descriptor_ids: ['output-1'],
          related_intervention_ids: ['intervention-1'],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:44:00.000Z',
          updated_at: '2026-03-27T22:44:00.000Z',
        },
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'terminal',
          brief_scope: 'workflow_timeline',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          llm_turn_count: null,
          status_kind: 'completed',
          short_brief: { headline: 'Release completed' },
          detailed_brief_json: { summary: 'Release completed successfully.' },
          linked_target_ids: ['workflow-1'],
          sequence_number: 3,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:43:00.000Z',
          updated_at: '2026-03-27T22:43:00.000Z',
        },
      ]),
    };

    const service = new WorkflowBriefsService(
      versionSource as never,
      briefSource as never,
    );

    const result = await service.getBriefs('tenant-1', 'workflow-1', {
      limit: 1,
    });

    expect(result).toEqual({
      generated_at: '2026-03-27T22:45:00.000Z',
      latest_event_id: 120,
      snapshot_version: 'workflow-operations:120',
      items: [
        {
          brief_id: 'brief-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-2',
          execution_context_id: 'execution-2',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_label: 'Orchestrator',
          source_role_name: 'Orchestrator',
          headline: 'Release ready',
          summary: 'Release is ready for operator review.',
          llm_turn_count: 4,
          status_kind: 'handoff',
          short_brief: { headline: 'Release ready' },
          detailed_brief_json: { summary: 'Release is ready for operator review.' },
          linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          sequence_number: 4,
          related_artifact_ids: ['artifact-1'],
          related_output_descriptor_ids: ['output-1'],
          related_intervention_ids: ['intervention-1'],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:44:00.000Z',
          updated_at: '2026-03-27T22:44:00.000Z',
        },
      ],
      total_count: 2,
      next_cursor: '2026-03-27T22:44:00.000Z|brief-2',
    });
  });

  it('passes selected scope filters through to the persisted brief source', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:45:00.000Z',
          latestEventId: 120,
        },
        packets: [],
      })),
    };
    const briefSource = {
      listBriefs: vi.fn(async () => []),
    };

    const service = new WorkflowBriefsService(
      versionSource as never,
      briefSource as never,
    );

    await service.getBriefs('tenant-1', 'workflow-1', {
      limit: 25,
      workItemId: 'work-item-1',
      taskId: 'task-1',
      after: '2026-03-27T22:44:00.000Z|brief-2',
    });

    expect(briefSource.listBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      unbounded: true,
    });
  });
});
