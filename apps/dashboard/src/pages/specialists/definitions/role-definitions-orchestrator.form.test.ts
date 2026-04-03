import { describe, expect, it } from 'vitest';

import type { FleetWorkerRecord } from '../../../lib/api.js';
import {
  buildOrchestratorModelDraft,
  buildOrchestratorPoolDraft,
  buildOrchestratorPromptDraft,
  listOrchestratorWorkerOptions,
  ORCHESTRATOR_INHERIT_MODEL,
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

  it('uses platform-owned orchestrator defaults when no worker exists yet', () => {
    expect(buildOrchestratorPoolDraft([])).toEqual({
      workerId: null,
      workerName: 'orchestrator-primary',
      runtimeImage: '',
      cpuLimit: '2',
      memoryLimit: '256m',
      replicas: '1',
      enabled: true,
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
    expect(buildOrchestratorPoolDraft(workers)).toEqual({
      workerId: 'worker-primary',
      workerName: 'orch-primary',
      runtimeImage: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.1',
      cpuLimit: '2',
      memoryLimit: '2Gi',
      replicas: '3',
      enabled: true,
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
});

function createWorker(overrides: Partial<FleetWorkerRecord>): FleetWorkerRecord {
  return {
    id: 'worker-default',
    worker_name: 'orch-default',
    role: 'orchestrator',
    pool_kind: 'orchestrator',
    runtime_image: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.1',
    cpu_limit: '2',
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
