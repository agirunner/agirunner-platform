import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('builds final deliverables, in-progress deliverables, working handoffs, and provenance packets', async () => {
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
          source_brief_id: 'brief-2',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
        {
          descriptor_id: 'deliverable-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'repo',
          delivery_stage: 'in_progress',
          title: 'Rollback Checklist',
          state: 'draft',
          summary_brief: 'Waiting on approval.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-1',
          created_at: '2026-03-27T22:34:00.000Z',
          updated_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'work_item_handoff',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          status_kind: 'handoff',
          short_brief: { headline: 'Verification handed the rollback checklist back for review.' },
          detailed_brief_json: {
            headline: 'Verification handed the rollback checklist back for review.',
            status_kind: 'handoff',
          },
          sequence_number: 4,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:33:00.000Z',
          updated_at: '2026-03-27T22:33:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => [
        {
          id: 'packet-launch',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'launch',
          source: 'operator',
          summary: 'Initial launch packet',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:30:00.000Z',
          files: [],
        },
        {
          id: 'packet-redrive',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'redrive_patch',
          source: 'redrive',
          summary: 'Retry with corrected inputs',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:31:00.000Z',
          updated_at: '2026-03-27T22:31:00.000Z',
          files: [],
        },
        {
          id: 'packet-intake',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intake',
          source: 'operator',
          summary: 'Added rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:00.000Z',
          updated_at: '2026-03-27T22:32:00.000Z',
          files: [],
        },
        {
          id: 'packet-intervention',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intervention_attachment',
          source: 'operator',
          summary: 'Attached rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:30.000Z',
          updated_at: '2026-03-27T22:32:30.000Z',
          files: [{ id: 'file-1', file_name: 'rollback.txt' }],
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );
    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-2' }),
    ]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({ id: 'brief-1' }),
    ]);
    expect(result.inputs_and_provenance).toEqual({
      launch_packet: expect.objectContaining({ id: 'packet-launch' }),
      supplemental_packets: [expect.objectContaining({ id: 'packet-intake' })],
      intervention_attachments: [expect.objectContaining({ id: 'packet-intervention' })],
      redrive_packet: expect.objectContaining({ id: 'packet-redrive' }),
    });
  });

  it('paginates deliverables and exposes the next cursor', async () => {
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
          source_brief_id: 'brief-2',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
        {
          descriptor_id: 'deliverable-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Validation Notes',
          state: 'final',
          summary_brief: 'Validation notes approved.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-3',
          created_at: '2026-03-27T22:34:00.000Z',
          updated_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const briefService = { listBriefs: vi.fn(async () => []) };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      limit: 1,
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.next_cursor).toBe('2026-03-27T22:35:00.000Z|deliverable-1');
  });
});
