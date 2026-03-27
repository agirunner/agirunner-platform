import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('splits final and in-progress deliverables and exposes inputs provenance placeholders', async () => {
    const liveService = {
      listWorkflowOutputDescriptors: vi.fn(async () =>
        new Map([
          [
            'workflow-1',
            [
              {
                id: 'deliverable-1',
                title: 'Release Notes',
                status: 'final',
              },
              {
                id: 'deliverable-2',
                title: 'Rollback Checklist',
                status: 'draft',
              },
            ],
          ],
        ]),
      ),
    };

    const service = new WorkflowDeliverablesService(liveService as never);
    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([expect.objectContaining({ id: 'deliverable-1' })]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({ id: 'deliverable-2' }),
    ]);
    expect(result.inputs_and_provenance).toEqual({
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    });
  });
});
