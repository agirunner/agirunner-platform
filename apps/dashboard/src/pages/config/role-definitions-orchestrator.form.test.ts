import { describe, expect, it } from 'vitest';

import type { FleetWorkerRecord } from '../../lib/api.js';
import {
  buildOrchestratorModelDraft,
  buildOrchestratorPoolDraft,
  buildOrchestratorPromptDraft,
  listOrchestratorWorkerOptions,
  ORCHESTRATOR_ASSIGNMENT_MODEL,
  ORCHESTRATOR_INHERIT_MODEL,
  resolveWorkerModelSelection,
} from './role-definitions-orchestrator.form.js';

describe('role definitions orchestrator form', () => {
  it('builds a direct prompt draft from the live platform instructions record', () => {
    expect(
      buildOrchestratorPromptDraft({
        version: 5,
        content: 'Keep delegation concise and request review when a gate blocks progress.',
      }),
    ).toEqual({
      content: 'Keep delegation concise and request review when a gate blocks progress.',
    });
  });

  it('defaults orchestrator model editing to inheritance when no override exists', () => {
    expect(buildOrchestratorModelDraft([])).toEqual({
      modelId: ORCHESTRATOR_INHERIT_MODEL,
      reasoningConfig: null,
    });
  });

  it('chooses the strongest enabled orchestrator worker as the quick-edit pool draft', () => {
    const workers: FleetWorkerRecord[] = [
      createWorker({
        id: 'worker-disabled',
        worker_name: 'orch-disabled',
        enabled: false,
        replicas: 2,
      }),
      createWorker({
        id: 'worker-primary',
        worker_name: 'orch-primary',
        enabled: true,
        replicas: 3,
        llm_model: 'gpt-5.4',
        llm_provider: 'OpenAI (Subscription)',
      }),
    ];
    const models = [
      {
        id: 'model-gpt54',
        model_id: 'gpt-5.4',
        provider_name: 'OpenAI (Subscription)',
        is_enabled: true,
      },
    ];

    expect(buildOrchestratorPoolDraft(workers, models)).toEqual({
      workerId: 'worker-primary',
      workerName: 'orch-primary',
      runtimeImage: 'ghcr.io/agisnap/agirunner-runtime:latest',
      replicas: '3',
      enabled: true,
      modelId: 'model-gpt54',
    });
    expect(listOrchestratorWorkerOptions(workers)).toEqual([
      {
        id: 'worker-primary',
        name: 'orch-primary',
        detail: 'Enabled · 3 desired replicas',
      },
      {
        id: 'worker-disabled',
        name: 'orch-disabled',
        detail: 'Disabled · 2 desired replicas',
      },
    ]);
  });

  it('converts a worker model pin into the provider/model payload expected by the fleet api', () => {
    expect(
      resolveWorkerModelSelection(
        [
          {
            id: 'model-gpt54',
            model_id: 'gpt-5.4',
            provider_name: 'OpenAI (Subscription)',
            is_enabled: true,
          },
        ],
        'model-gpt54',
      ),
    ).toEqual({
      llmProvider: 'OpenAI (Subscription)',
      llmModel: 'gpt-5.4',
    });
    expect(resolveWorkerModelSelection([], ORCHESTRATOR_ASSIGNMENT_MODEL)).toEqual({});
  });
});

function createWorker(overrides: Partial<FleetWorkerRecord>): FleetWorkerRecord {
  return {
    id: 'worker-default',
    worker_name: 'orch-default',
    role: 'orchestrator',
    pool_kind: 'orchestrator',
    runtime_image: 'ghcr.io/agisnap/agirunner-runtime:latest',
    cpu_limit: '1',
    memory_limit: '2Gi',
    network_policy: 'default',
    environment: {},
    llm_provider: null,
    llm_model: null,
    replicas: 1,
    enabled: true,
    restart_requested: false,
    draining: false,
    version: 1,
    created_at: '2026-03-13T00:00:00.000Z',
    updated_at: '2026-03-13T00:00:00.000Z',
    updated_by: null,
    actual: [],
    ...overrides,
  };
}
