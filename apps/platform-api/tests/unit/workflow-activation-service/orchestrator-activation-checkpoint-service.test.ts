import { describe, expect, it, vi } from 'vitest';

import { OrchestratorActivationCheckpointService } from '../../../src/services/orchestrator/orchestrator-activation-checkpoint-service.js';

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

  it('derives a checkpoint from activation and continuity state under platform ownership', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            metadata: {
              orchestrator_finish_state: {
                status_summary: 'Waiting on reviewer reassessment.',
                next_expected_event: 'task.output_pending_assessment',
                active_subordinate_tasks: ['task-review-1'],
              },
            },
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            event_type: 'task.handoff_submitted',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            metadata: {
              keep_me: 'present',
              last_activation_checkpoint: {
                activation_id: 'activation-3',
                trigger: 'task.handoff_submitted',
                current_working_state: 'Waiting on reviewer reassessment.',
                next_expected_event: 'task.output_pending_assessment',
                important_ids: ['work-item-7', 'task-review-1'],
              },
            },
          }],
        }),
    };

    const service = new OrchestratorActivationCheckpointService(pool as never);
    const checkpoint = await service.persistDerivedCheckpoint(
      'tenant-1',
      {
        task_id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-7',
        activation_id: 'activation-3',
      },
    );

    expect(checkpoint).toEqual({
      activation_id: 'activation-3',
      trigger: 'task.handoff_submitted',
      current_working_state: 'Waiting on reviewer reassessment.',
      next_expected_event: 'task.output_pending_assessment',
      important_ids: ['work-item-7', 'task-review-1'],
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM workflow_activations'),
      ['tenant-1', 'workflow-1', 'activation-3'],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-7'],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(`jsonb_build_object('last_activation_checkpoint'`),
      [
        'tenant-1',
        'task-1',
        {
          activation_id: 'activation-3',
          trigger: 'task.handoff_submitted',
          current_working_state: 'Waiting on reviewer reassessment.',
          next_expected_event: 'task.output_pending_assessment',
          important_ids: ['work-item-7', 'task-review-1'],
        },
      ],
    );
  });
});
