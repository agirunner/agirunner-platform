import { describe, expect, it, vi } from 'vitest';

import { PipelineControlService } from '../../src/services/pipeline-control-service.js';

const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

describe('PipelineControlService', () => {
  it('pauses active pipelines and emits an audit event', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'pipeline-1', state: 'paused' }],
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new PipelineControlService(pool as never, eventService as never, { recomputePipelineState: vi.fn() } as never);

    const result = await service.pausePipeline(identity, 'pipeline-1');

    expect(result.state).toBe('paused');
    expect(eventService.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'pipeline.paused' }));
  });

  it('manual rework resets eligible tasks and returns recomputed pipeline state', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 2,
        rows: [{ id: 'task-1' }, { id: 'task-2' }],
      }),
    };
    const stateService = { recomputePipelineState: vi.fn().mockResolvedValue('active') };
    const eventService = { emit: vi.fn() };
    const service = new PipelineControlService(pool as never, eventService as never, stateService as never);

    const result = await service.manualReworkPipeline(identity, 'pipeline-1', 'Address reviewer feedback');

    expect(result).toEqual({ id: 'pipeline-1', updated_tasks: 2, state: 'active' });
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pipeline.manual_rework',
        data: expect.objectContaining({ updated_tasks: 2 }),
      }),
    );
  });
});
