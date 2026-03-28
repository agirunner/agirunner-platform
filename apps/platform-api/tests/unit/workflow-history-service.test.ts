import { describe, expect, it, vi } from 'vitest';

import { WorkflowHistoryService } from '../../src/services/workflow-operations/workflow-history-service.js';

describe('WorkflowHistoryService', () => {
  it('builds newest-first brief packets from briefs, interventions, and inputs without replaying live updates', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
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
          short_brief: { headline: 'Release package moved to approval' },
          detailed_brief_json: {
            headline: 'Release package moved to approval',
            status_kind: 'in_progress',
            summary: 'Verification completed and approval is now required.',
          },
          sequence_number: 4,
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
    };
    const updateService = {
      listUpdates: vi.fn(async () => []),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => [
        {
          id: 'intervention-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          kind: 'workflow_action',
          origin: 'operator',
          status: 'applied',
          summary: 'Paused workflow for manual review',
          note: null,
          structured_action: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:38:00.000Z',
          updated_at: '2026-03-27T22:38:00.000Z',
          files: [],
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => [
        {
          id: 'packet-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'launch',
          source: 'operator',
          summary: 'Initial launch packet',
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
          packet_kind: 'redrive_patch',
          source: 'redrive',
          summary: 'Retry with corrected inputs',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:36:00.000Z',
          updated_at: '2026-03-27T22:36:00.000Z',
          files: [],
        },
      ]),
    };
    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    );
    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 5 });

    expect(result.snapshot_version).toBe('workflow-operations:110');
    expect(result.groups).toEqual([
      expect.objectContaining({
        group_id: '2026-03-27',
        item_ids: ['brief-1', 'intervention-1', 'packet-1', 'packet-2'],
      }),
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-1',
        item_kind: 'milestone_brief',
        headline: 'Release package moved to approval',
        source_kind: 'orchestrator',
        source_label: 'Orchestrator',
      }),
      expect.objectContaining({
        item_id: 'intervention-1',
        item_kind: 'intervention',
        headline: 'Paused workflow for manual review',
      }),
      expect.objectContaining({
        item_id: 'packet-1',
        item_kind: 'input',
        headline: 'Initial launch packet',
      }),
      expect.objectContaining({
        item_id: 'packet-2',
        item_kind: 'redrive',
        headline: 'Retry with corrected inputs',
      }),
    ]);
    expect(result.next_cursor).toBeNull();
    expect(result.filters).toEqual({
      available: ['briefs', 'interventions', 'inputs', 'redrives'],
      active: [],
    });
  });

  it('excludes plain turn updates from history packets', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
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
          headline: 'Verification is reviewing rollback handling',
          summary: 'Validation is still running.',
          linked_target_ids: ['workflow-1'],
          visibility_mode: 'enhanced',
          promoted_brief_id: null,
          sequence_number: 1,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:39:30.000Z',
        },
      ]),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    );
    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  it('passes selected task scope through to history sources', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
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
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    );

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
    const service = new WorkflowHistoryService(
      {
        getHistory: vi.fn(async () => ({
          version: {
            generatedAt: '2026-03-27T22:40:00.000Z',
            latestEventId: 110,
            token: 'mission-control:110',
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
      } as never,
      {
        listUpdates: vi.fn(async () => []),
      } as never,
      {
        listWorkflowInterventions: vi.fn(async () => []),
      } as never,
      {
        listWorkflowInputPackets: vi.fn(async () => []),
      } as never,
    );

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
    const service = new WorkflowHistoryService(
      {
        getHistory: vi.fn(async () => ({
          version: {
            generatedAt: '2026-03-27T22:40:00.000Z',
            latestEventId: 110,
            token: 'mission-control:110',
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
      } as never,
      {
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
      } as never,
    );

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
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
        },
        packets: [],
      })),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const updateService = {
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
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const inputPacketService = {
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
    };
    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    );

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

  it('does not leak lifecycle logs into the primary history stream when milestone briefs are absent', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
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
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    );

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
  });

  it('stays empty when only lifecycle logs exist and no history packets were published', async () => {
    const versionSource = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:40:00.000Z',
          latestEventId: 110,
          token: 'mission-control:110',
        },
        packets: [],
      })),
    };

    const service = new WorkflowHistoryService(
      versionSource as never,
      { listBriefs: vi.fn(async () => []) } as never,
      { listUpdates: vi.fn(async () => []) } as never,
      { listWorkflowInterventions: vi.fn(async () => []) } as never,
      { listWorkflowInputPackets: vi.fn(async () => []) } as never,
    );

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
  });
});
