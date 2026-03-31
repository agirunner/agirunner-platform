import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service.js';

describe('HandoffService completion gate', () => {
  it('requires a structured handoff before completing a workflow-linked task', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        is_orchestrator_task: false,
        role: 'developer',
        input: {},
        metadata: { task_kind: 'delivery' },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Task requires a structured handoff before completion',
      details: {
        reason_code: 'required_structured_handoff',
        recovery_hint: 'submit_required_handoff',
        recoverable: true,
        recovery: {
          status: 'action_required',
          reason: 'required_structured_handoff',
          action: 'submit_required_handoff',
        },
      },
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM task_handoffs'),
      ['tenant-1', 'task-1', 0],
    );
  });

  it('accepts a matching current-attempt structured handoff before completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'handoff-1' }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        is_orchestrator_task: false,
        role: 'developer',
        rework_count: 1,
        input: {},
        metadata: { task_kind: 'delivery' },
      }),
    ).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM task_handoffs'),
      ['tenant-1', 'task-1', 1],
    );
  });

  it('does not require a structured handoff for standalone tasks outside workflow control', async () => {
    const pool = {
      query: vi.fn(),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-standalone',
        workflow_id: null,
        role: 'developer',
        input: {},
        metadata: {},
      }),
    ).resolves.toBeUndefined();

    expect(pool.query).not.toHaveBeenCalled();
  });
});
