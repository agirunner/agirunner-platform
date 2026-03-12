import { describe, expect, it } from 'vitest';

import {
  addEnvironmentEntry,
  buildCreateWorkerPayload,
  buildEnvironmentEntries,
  buildEnvironmentRecord,
  buildUpdateWorkerPayload,
  buildWorkerFormValues,
  listModelsForProvider,
  listSuggestedWorkerRoles,
  removeEnvironmentEntry,
  updateEnvironmentEntry,
} from './worker-list-page.support.js';

describe('worker list support', () => {
  it('builds structured form values from an existing worker record', () => {
    const values = buildWorkerFormValues({
      id: 'worker-1',
      worker_name: 'specialist-qa-1',
      role: 'qa',
      pool_kind: 'specialist',
      runtime_image: 'ghcr.io/agirunner/runtime:stable',
      cpu_limit: '2',
      memory_limit: '4g',
      network_policy: 'open',
      environment: { FEATURE_FLAG: 'on' },
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_api_key_secret_ref_configured: true,
      replicas: 2,
      enabled: false,
      restart_requested: false,
      draining: false,
      version: 1,
      created_at: '2026-03-12T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
      updated_by: null,
      actual: [],
    });

    expect(values.workerName).toBe('specialist-qa-1');
    expect(values.networkPolicy).toBe('open');
    expect(values.environmentEntries[0]).toMatchObject({ key: 'FEATURE_FLAG', value: 'on' });
    expect(values.enabled).toBe(false);
  });

  it('builds create and update payloads with structured environment state', () => {
    const formValues = {
      workerName: 'worker-1',
      role: 'developer',
      poolKind: 'specialist' as const,
      runtimeImage: 'ghcr.io/agirunner/runtime:latest',
      cpuLimit: '4',
      memoryLimit: '8g',
      networkPolicy: 'restricted' as const,
      environmentEntries: [{ id: 'env-1', key: 'TOKEN_REF', value: 'secret:tenant/token' }],
      llmProvider: 'openai',
      llmModel: 'gpt-5',
      llmApiKeySecretRef: '',
      replicas: '3',
      enabled: true,
    };

    expect(buildCreateWorkerPayload(formValues)).toMatchObject({
      workerName: 'worker-1',
      environment: { TOKEN_REF: 'secret:tenant/token' },
      replicas: 3,
    });
    expect(buildUpdateWorkerPayload(formValues)).not.toHaveProperty('workerName');
  });

  it('supports structured environment row editing without raw JSON', () => {
    const seed = buildEnvironmentEntries({});
    const added = addEnvironmentEntry(seed);
    const updated = updateEnvironmentEntry(added, added[0].id, { key: 'FOO', value: 'bar' });
    const removed = removeEnvironmentEntry(updated, updated[1].id);

    expect(buildEnvironmentRecord(removed)).toEqual({ FOO: 'bar' });
  });

  it('filters models to the selected provider and lists known worker roles', () => {
    const models = listModelsForProvider(
      [
        { id: 'm-1', model_id: 'gpt-5', provider_id: 'p-1', provider_name: 'OpenAI', is_enabled: true },
        { id: 'm-2', model_id: 'sonnet', provider_id: 'p-2', provider_name: 'Anthropic', is_enabled: true },
      ],
      { id: 'p-1', name: 'OpenAI', auth_mode: 'api_key', credentials_configured: true },
    );
    const roles = listSuggestedWorkerRoles([
      {
        id: 'worker-1',
        worker_name: 'worker-1',
        role: 'developer',
        pool_kind: 'specialist',
        runtime_image: 'img',
        cpu_limit: '1',
        memory_limit: '1g',
        network_policy: 'restricted',
        environment: {},
        llm_provider: null,
        llm_model: null,
        replicas: 1,
        enabled: true,
        restart_requested: false,
        draining: false,
        version: 1,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
        updated_by: null,
        actual: [],
      },
      {
        id: 'worker-2',
        worker_name: 'worker-2',
        role: 'reviewer',
        pool_kind: 'specialist',
        runtime_image: 'img',
        cpu_limit: '1',
        memory_limit: '1g',
        network_policy: 'restricted',
        environment: {},
        llm_provider: null,
        llm_model: null,
        replicas: 1,
        enabled: true,
        restart_requested: false,
        draining: false,
        version: 1,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
        updated_by: null,
        actual: [],
      },
    ]);

    expect(models.map((model) => model.model_id)).toEqual(['gpt-5']);
    expect(roles).toEqual(['developer', 'reviewer']);
  });
});
