import { describe, expect, it, vi } from 'vitest';

import { WorkflowHistoryService } from '../../src/services/workflow-operations/workflow-history-service.js';

describe('WorkflowHistoryService', () => {
  it('builds newest-first history packets from briefs, interventions, inputs, and deliverables with cursors', async () => {
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
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Release Notes',
          state: 'final',
          summary_brief: 'Final release notes approved.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };

    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      interventionService as never,
      inputPacketService as never,
      deliverableService as never,
    );
    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 4 });

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
    expect(result.next_cursor).toBe('2026-03-27T22:36:00.000Z|packet-2');
    expect(result.filters).toEqual({
      available: ['briefs', 'interventions', 'inputs', 'deliverables', 'redrives'],
      active: [],
    });
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
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };

    const service = new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      interventionService as never,
      inputPacketService as never,
      deliverableService as never,
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
});
