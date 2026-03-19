import { describe, expect, it, vi } from 'vitest';

import { OrchestratorActivationCheckpointService } from '../../src/services/orchestrator-activation-checkpoint-service.js';

describe('OrchestratorActivationCheckpointService', () => {
  it('persists the latest activation checkpoint without clobbering unrelated metadata', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{
          metadata: {
            keep_me: 'present',
            last_activation_checkpoint: {
              activation_id: 'activation-2',
              current_working_state: 'waiting on review',
            },
          },
        }],
      }),
    };

    const service = new OrchestratorActivationCheckpointService(pool as never);
    const checkpoint = await service.persistCheckpoint(
      'tenant-1',
      'task-1',
      {
        activation_id: 'activation-2',
        current_working_state: 'waiting on review',
      },
    );

    expect(checkpoint).toEqual({
      activation_id: 'activation-2',
      current_working_state: 'waiting on review',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(`jsonb_build_object('last_activation_checkpoint'`),
      [
        'tenant-1',
        'task-1',
        {
          activation_id: 'activation-2',
          current_working_state: 'waiting on review',
        },
      ],
    );
  });
});
