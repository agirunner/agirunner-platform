import { describe, expect, it, vi } from 'vitest';

import { createWorkflowHistoryService, createVersionSource } from './support.js';

describe('WorkflowHistoryService scope and filtering', () => {
  it('passes selected task scope through to history sources', async () => {
    const { service, briefService, updateService } = createWorkflowHistoryService();

    await service.getHistory('tenant-1', 'workflow-1', {
      limit: 10,
      workItemId: 'work-item-7',
      taskId: 'task-4',
    });

    expect(briefService.listBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 500,
    });
    expect(updateService.listUpdates).not.toHaveBeenCalled();
  });

  it('preserves persisted linked target ids and explicit scope ids in history items', async () => {
    const { service } = createWorkflowHistoryService({
      versionSource: createVersionSource(),
      briefService: {
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
            short_brief: { headline: 'Policy review sent the item back' },
            detailed_brief_json: {
              headline: 'Policy review sent the item back',
              status_kind: 'in_progress',
              summary: 'Revision 2 still needs owner detail.',
            },
            linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
            sequence_number: 9,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:39:00.000Z',
            updated_at: '2026-03-27T22:39:00.000Z',
          },
        ]),
      },
    });

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-1',
        work_item_id: null,
        task_id: null,
        linked_target_ids: ['workflow-1', 'work-item-44', 'task-11'],
      }),
    ]);
  });

  it('filters interventions by selected task and excludes workflow-level packets from work-item scope', async () => {
    const { service } = createWorkflowHistoryService({
      interventionService: {
        listWorkflowInterventions: vi.fn(async () => [
          {
            id: 'intervention-work-item',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-7',
            task_id: null,
            request_id: null,
            kind: 'workflow_action',
            origin: 'operator',
            status: 'applied',
            outcome: 'applied',
            result_kind: 'workflow_paused',
            snapshot_version: 'workflow-operations:111',
            settings_revision: 2,
            summary: 'Paused the work item',
            message: null,
            note: null,
            structured_action: {},
            metadata: {},
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:38:00.000Z',
            updated_at: '2026-03-27T22:38:00.000Z',
            files: [],
          },
          {
            id: 'intervention-task',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-7',
            task_id: 'task-4',
            request_id: null,
            kind: 'workflow_action',
            origin: 'operator',
            status: 'applied',
            outcome: 'applied',
            result_kind: 'task_paused',
            snapshot_version: 'workflow-operations:112',
            settings_revision: 2,
            summary: 'Paused the selected task',
            message: null,
            note: null,
            structured_action: {},
            metadata: {},
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:39:00.000Z',
            updated_at: '2026-03-27T22:39:00.000Z',
            files: [],
          },
        ]),
      },
      inputPacketService: {
        listWorkflowInputPackets: vi.fn(async () => [
          {
            id: 'packet-workflow',
            workflow_id: 'workflow-1',
            work_item_id: null,
            request_id: null,
            source_intervention_id: null,
            source_attempt_id: null,
            packet_kind: 'launch',
            source: 'operator',
            summary: 'Workflow launch packet',
            structured_inputs: {},
            metadata: {},
            created_by_kind: 'operator',
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:37:00.000Z',
            updated_at: '2026-03-27T22:37:00.000Z',
            files: [],
          },
          {
            id: 'packet-work-item',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-7',
            request_id: null,
            source_intervention_id: null,
            source_attempt_id: null,
            packet_kind: 'intake',
            source: 'operator',
            summary: 'Selected work item packet',
            structured_inputs: {},
            metadata: {},
            created_by_kind: 'operator',
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:36:00.000Z',
            updated_at: '2026-03-27T22:36:00.000Z',
            files: [],
          },
        ]),
      },
    });

    const result = await service.getHistory('tenant-1', 'workflow-1', {
      limit: 10,
      workItemId: 'work-item-7',
      taskId: 'task-4',
    });

    expect(result.items.map((item) => item.item_id)).toEqual([
      'intervention-task',
      'packet-work-item',
    ]);
  });

  it('filters older history items when an after cursor is supplied', async () => {
    const { service } = createWorkflowHistoryService({
      updateService: {
        listUpdates: vi.fn(async () => [
          {
            id: 'update-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: 'request-update-1',
            execution_context_id: 'execution-update-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            update_kind: 'turn_update',
            headline: 'Newest update',
            summary: 'Still running.',
            linked_target_ids: ['workflow-1'],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 2,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:38:00.000Z',
          },
        ]),
      },
      inputPacketService: {
        listWorkflowInputPackets: vi.fn(async () => [
          {
            id: 'packet-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            packet_kind: 'launch',
            source: 'operator',
            summary: 'Launch packet',
            structured_inputs: {},
            metadata: {},
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:37:00.000Z',
            updated_at: '2026-03-27T22:37:00.000Z',
            files: [],
          },
          {
            id: 'packet-2',
            workflow_id: 'workflow-1',
            work_item_id: null,
            packet_kind: 'intake',
            source: 'operator',
            summary: 'Intake packet',
            structured_inputs: {},
            metadata: {},
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:36:00.000Z',
            updated_at: '2026-03-27T22:36:00.000Z',
            files: [],
          },
        ]),
      },
    });

    const result = await service.getHistory('tenant-1', 'workflow-1', {
      after: '2026-03-27T22:37:00.000Z|packet-1',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'packet-2',
        item_kind: 'input',
      }),
    ]);
  });
});
