import { describe, expect, it, vi } from 'vitest';

import { WorkflowControlService } from '../../src/services/workflow-control-service.js';

const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

describe('WorkflowControlService', () => {
  it('pauses active workflows and emits an audit event', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'workflow-1', state: 'paused' }],
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowControlService(pool as never, eventService as never, { recomputeWorkflowState: vi.fn() } as never);

    const result = await service.pauseWorkflow(identity, 'workflow-1');

    expect(result.state).toBe('paused');
    expect(eventService.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.paused' }));
  });
});
