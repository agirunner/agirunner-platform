import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import {
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
  buildRecoverableApproveTaskNoop,
  buildRecoverableMissingManagedTaskNoop,
  isRecoverableNotAppliedResult,
  runIdempotentMutation,
} from '../../../../../src/api/routes/orchestrator-control/shared.js';
import { logSafetynetTriggered } from '../../../../../src/services/safetynet/logging.js';

describe('orchestrator control shared helpers', () => {
  beforeEach(() => {
    vi.mocked(logSafetynetTriggered).mockReset();
  });

  it('detects recoverable not applied mutation results', () => {
    expect(
      isRecoverableNotAppliedResult({
        mutation_outcome: 'recoverable_not_applied',
      }),
    ).toBe(true);
    expect(
      isRecoverableNotAppliedResult({
        mutation_outcome: 'applied',
      }),
    ).toBe(false);
    expect(isRecoverableNotAppliedResult({})).toBe(false);
  });

  it('runs non-idempotent mutations inside a transaction when request_id is blank', async () => {
    const response = { ok: true };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
      release: vi.fn(),
    };
    const app = {
      pgPool: {
        connect: vi.fn(async () => client),
      },
    };

    const result = await runIdempotentMutation(
      app as never,
      {} as never,
      'tenant-1',
      'workflow-1',
      'tool_name',
      '   ',
      async (txClient) => {
        expect(txClient).toBe(client);
        return response;
      },
    );

    expect(result).toBe(response);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('tags and logs missing managed task recoverable noops with the not-ready safetynet', () => {
    const response = buildRecoverableMissingManagedTaskNoop(
      {
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
      } as never,
      '22222222-2222-4222-8222-222222222222',
    );

    expect(response).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'managed_task_not_found',
      reason_code: 'managed_task_not_found',
      safetynet_behavior_id: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    });
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      NOT_READY_NOOP_RECOVERY_SAFETYNET,
      'recoverable managed task noop returned because the managed specialist task no longer exists',
      {
        workflow_id: 'workflow-1',
        task_id: '22222222-2222-4222-8222-222222222222',
        work_item_id: 'work-item-1',
        reason_code: 'managed_task_not_found',
      },
    );
  });

  it('tags and logs stale approval recoverable noops with the not-ready safetynet', () => {
    const response = buildRecoverableApproveTaskNoop(
      {
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
      } as never,
      {
        id: '22222222-2222-4222-8222-222222222222',
        work_item_id: 'work-item-2',
        stage_name: 'review',
        state: 'output_pending_assessment',
      },
    );

    expect(response).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'task_not_awaiting_approval',
      reason_code: 'task_not_awaiting_approval',
      safetynet_behavior_id: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    });
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      NOT_READY_NOOP_RECOVERY_SAFETYNET,
      'recoverable approve_task noop returned because the managed specialist task is no longer awaiting approval',
      {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-2',
        task_id: '22222222-2222-4222-8222-222222222222',
        stage_name: 'review',
        reason_code: 'task_not_awaiting_approval',
      },
    );
  });
});
