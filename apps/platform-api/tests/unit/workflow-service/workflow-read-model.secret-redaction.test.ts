import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { WorkflowService } from '../../../src/services/workflow-service/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: resolve('tmp'),
};

describe('WorkflowService task read redaction', () => {
  it('bounds secret redaction triggers for a secret-bearing embedded task detail', async () => {
    logSafetynetTriggeredMock.mockReset();

    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {},
              context: {},
              parameters: {},
              resolved_config: {},
              config_layers: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-1',
              tenant_id: 'tenant-1',
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
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: { columns: [{ id: 'queued', label: 'Queued' }] },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');

    expect(workflow.tasks).toEqual([
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
    ]);
    expect(logSafetynetTriggeredMock).toHaveBeenCalledTimes(2);
  });
});
