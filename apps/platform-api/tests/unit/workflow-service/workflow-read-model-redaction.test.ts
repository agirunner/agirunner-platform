import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { sanitizeTaskReadModel } from '../../../src/services/workflow-service/workflow-read-model.js';

describe('sanitizeTaskReadModel', () => {
  it('redacts a task detail projection with one safetynet trigger per task', () => {
    logSafetynetTriggeredMock.mockReset();

    const sanitized = sanitizeTaskReadModel({
      id: 'task-1',
      workflow_id: 'wf-1',
      input: { api_key: 'task-input-secret', api_key_secret_ref: 'secret:TASK_INPUT_KEY' },
      context: { password: 'task-context-secret', token_ref: 'secret:TASK_CONTEXT_TOKEN' },
      output: { token: 'task-output-secret', result_ref: 'secret:TASK_OUTPUT_TOKEN' },
      error: { authorization: 'Bearer failure-secret', secret_ref: 'secret:TASK_ERROR_SECRET' },
      role_config: {
        webhook_url: 'https://hooks.slack.com/services/plain-secret',
        api_key_secret_ref: 'secret:TASK_ROLE_SECRET',
      },
      environment: { ACCESS_TOKEN: 'task-env-secret', TOKEN_REF: 'secret:TASK_ENV_SECRET' },
      resource_bindings: [{ credentials: { token: 'binding-secret', token_ref: 'secret:TASK_BINDING_SECRET' } }],
      metrics: { summary: 'kept' },
      git_info: { private_key: 'task-git-secret', ssh_key_ref: 'secret:TASK_GIT_SECRET' },
      metadata: { refresh_token: 'task-meta-secret', secret_ref: 'secret:TASK_META_SECRET' },
    });

    expect(sanitized).toEqual(
      expect.objectContaining({
        input: {
          api_key: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        context: {
          password: 'redacted://task-secret',
          token_ref: 'redacted://task-secret',
        },
        output: {
          token: 'redacted://task-secret',
          result_ref: 'redacted://task-secret',
        },
        error: {
          authorization: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
        role_config: {
          webhook_url: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        environment: {
          ACCESS_TOKEN: 'redacted://task-secret',
          TOKEN_REF: 'redacted://task-secret',
        },
        resource_bindings: [{
          credentials: {
            token: 'redacted://task-secret',
            token_ref: 'redacted://task-secret',
          },
        }],
        metrics: { summary: 'kept' },
        git_info: {
          private_key: 'redacted://task-secret',
          ssh_key_ref: 'redacted://task-secret',
        },
        metadata: {
          refresh_token: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
      }),
    );
    expect(logSafetynetTriggeredMock).toHaveBeenCalledTimes(1);
  });
});
