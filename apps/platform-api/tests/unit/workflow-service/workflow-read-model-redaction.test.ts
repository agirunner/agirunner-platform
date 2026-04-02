import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { sanitizeTaskReadModel } from '../../../src/services/workflow-service/workflow-read-model.js';

describe('sanitizeTaskReadModel', () => {
  it('omits activation dispatch tokens from task detail payloads without redaction churn', () => {
    logSafetynetTriggeredMock.mockReset();

    const sanitized = sanitizeTaskReadModel({
      id: 'task-1',
      workflow_id: 'wf-1',
      input: {
        activation_dispatch_token: '42263cfb-cf11-4e0e-8533-f9ddbd046e75',
        activation_reason: 'work_item.created',
      },
      metadata: {
        activation_dispatch_token: '42263cfb-cf11-4e0e-8533-f9ddbd046e75',
        activation_event_type: 'work_item.created',
      },
    });

    expect(sanitized).toEqual(
      expect.objectContaining({
        input: {
          activation_reason: 'work_item.created',
        },
        metadata: {
          activation_event_type: 'work_item.created',
        },
      }),
    );
    expect(sanitized.input).not.toHaveProperty('activation_dispatch_token');
    expect(sanitized.metadata).not.toHaveProperty('activation_dispatch_token');
    expect(logSafetynetTriggeredMock).not.toHaveBeenCalled();
  });

  it('redacts task input and metadata payloads with one safetynet trigger per payload', () => {
    logSafetynetTriggeredMock.mockReset();

    const sanitized = sanitizeTaskReadModel({
      id: 'task-1',
      workflow_id: 'wf-1',
      input: { api_key: 'task-input-secret', api_key_secret_ref: 'secret:TASK_INPUT_KEY' },
      metadata: { refresh_token: 'task-meta-secret', secret_ref: 'secret:TASK_META_SECRET' },
    });

    expect(sanitized).toEqual(
      expect.objectContaining({
        input: {
          api_key: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        metadata: {
          refresh_token: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
      }),
    );
    expect(logSafetynetTriggeredMock).toHaveBeenCalledTimes(2);
  });
});
