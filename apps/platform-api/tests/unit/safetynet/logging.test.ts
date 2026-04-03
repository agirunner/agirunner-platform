import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  inc: vi.fn(),
}));

vi.mock('../../../src/observability/logger.js', () => ({
  createLogger: () => ({
    info: mocks.info,
  }),
}));

vi.mock('../../../src/observability/request-context.js', () => ({
  getRequestContext: () => ({
    requestId: 'ctx-request',
    workflowId: 'ctx-workflow',
    taskId: 'ctx-task',
  }),
}));

vi.mock('../../../src/observability/metrics.js', () => ({
  safetynetTriggerCounter: {
    inc: mocks.inc,
  },
}));

import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import { mustGetSafetynetEntry, PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID } from '../../../src/services/safetynet/registry.js';

describe('platform safetynet logging', () => {
  beforeEach(() => {
    mocks.info.mockReset();
    mocks.inc.mockReset();
  });

  it('preserves canonical safetynet log fields even when payload includes overlapping keys', () => {
    const entry = mustGetSafetynetEntry(PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID);

    logSafetynetTriggered(entry, 'test trigger', {
      event_type: 'workflow.activation_requeued',
      request_id: 'payload-request',
      workflow_id: 'payload-workflow',
      task_id: 'payload-task',
      extra_detail: 'kept',
    });

    expect(mocks.inc).toHaveBeenCalledWith({ behavior: PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID });
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'platform.safetynet.triggered',
        safetynet_behavior_id: PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
        trigger_reason: 'test trigger',
        request_id: 'payload-request',
        workflow_id: 'payload-workflow',
        task_id: 'payload-task',
        extra_detail: 'kept',
      }),
    );
  });
});
