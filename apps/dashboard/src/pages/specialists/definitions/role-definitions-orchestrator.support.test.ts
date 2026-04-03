import { describe, expect, it } from 'vitest';

import {
  summarizeOrchestratorReadiness,
  summarizeOrchestratorPool,
} from './role-definitions-orchestrator.support.js';
import { DEFAULT_RUNTIME_IMAGE_BOOTSTRAP_LABEL } from '../../runtime-config-shared/runtime-image-defaults.js';

const TEST_RELEASE_RUNTIME_IMAGE = 'ghcr.io/agirunner/agirunner-runtime:9.8.7-rc.1';

describe('role definitions orchestrator support', () => {
  it('summarizes orchestrator pool posture from live worker and pool state', () => {
    expect(
      summarizeOrchestratorPool(
        {
          global_max_runtimes: 0,
          total_running: 0,
          total_idle: 0,
          total_executing: 0,
          total_draining: 0,
          worker_pools: [
            {
              pool_kind: 'orchestrator',
              desired_workers: 2,
              desired_replicas: 4,
              enabled_workers: 2,
              draining_workers: 0,
              running_containers: 3,
            },
          ],
          by_playbook: [],
          by_playbook_pool: [],
          recent_events: [],
        },
        [
          {
            id: 'worker-1',
            worker_name: 'orchestrator-a',
            role: 'orchestrator',
            pool_kind: 'orchestrator',
            runtime_image: TEST_RELEASE_RUNTIME_IMAGE,
            cpu_limit: '2',
            memory_limit: '2Gi',
            network_policy: 'default',
            environment: {},
            llm_provider: 'OpenAI',
            llm_model: 'gpt-5.4',
            replicas: 2,
            enabled: true,
            restart_requested: false,
            draining: false,
            version: 1,
            created_at: '2026-03-12T00:00:00.000Z',
            updated_at: '2026-03-12T00:00:00.000Z',
            updated_by: null,
            actual: [],
          },
        ],
      ),
    ).toEqual({
      desiredWorkers: 2,
      desiredReplicas: 4,
      enabledWorkers: 2,
      runningContainers: 3,
      runtimeLabel: TEST_RELEASE_RUNTIME_IMAGE,
      resourceLabel: '2 CPU · 2Gi memory',
    });
  });

  it('falls back to bootstrap runtime and default resources when no worker exists yet', () => {
    expect(summarizeOrchestratorPool(undefined, [])).toEqual({
      desiredWorkers: 0,
      desiredReplicas: 0,
      enabledWorkers: 0,
      runningContainers: 0,
      runtimeLabel: DEFAULT_RUNTIME_IMAGE_BOOTSTRAP_LABEL,
      resourceLabel: '2 CPU · 256m memory',
    });
  });

  it('marks the control plane unready when prompt, model, and capacity are missing', () => {
    const readiness = summarizeOrchestratorReadiness(
      {
        statusLabel: 'No active prompt',
        versionLabel: 'Not configured',
        excerpt: 'missing',
      },
      {
        modelLabel: 'Use system default',
        reasoningLabel: 'No explicit reasoning profile',
        sourceLabel: 'System default',
      },
      {
        desiredWorkers: 0,
        desiredReplicas: 0,
        enabledWorkers: 0,
        runningContainers: 0,
        runtimeLabel: 'agirunner-runtime:local',
        resourceLabel: '2 CPU · 256m memory',
      },
    );

    expect(readiness.isReady).toBe(false);
    expect(readiness.issues.map((issue) => issue.id)).toEqual(['prompt', 'model', 'pool']);
  });

  it('marks the control plane ready when prompt, model, and pool posture are configured', () => {
    const readiness = summarizeOrchestratorReadiness(
      {
        statusLabel: 'Prompt configured',
        versionLabel: 'v3',
        excerpt: 'Coordinate work and request review when a stage gate requires it.',
      },
      {
        modelLabel: 'gpt-5.4 (OpenAI)',
        reasoningLabel: 'Reasoning: medium',
        sourceLabel: 'System default',
      },
      {
        desiredWorkers: 1,
        desiredReplicas: 2,
        enabledWorkers: 1,
        runningContainers: 1,
        runtimeLabel: TEST_RELEASE_RUNTIME_IMAGE,
        resourceLabel: '2 CPU · 2Gi memory',
      },
    );

    expect(readiness.isReady).toBe(true);
    expect(readiness.issues).toEqual([]);
  });
});
