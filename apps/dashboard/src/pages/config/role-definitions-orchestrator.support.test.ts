import { describe, expect, it } from 'vitest';

import {
  summarizeOrchestratorReadiness,
  summarizeOrchestratorModel,
  summarizeOrchestratorPool,
  summarizeOrchestratorPrompt,
  summarizeReasoningConfig,
  type RoleAssignmentRecord,
  type SystemDefaultRecord,
} from './role-definitions-orchestrator.support.js';

describe('role definitions orchestrator support', () => {
  it('summarizes orchestrator prompt posture with versioned excerpts', () => {
    expect(
      summarizeOrchestratorPrompt({
        content:
          'Keep orchestration brief, verify outcomes, and prefer explicit recovery steps when work stalls.',
        format: 'markdown',
        version: 7,
        updated_at: '2026-03-12T00:00:00.000Z',
      }),
    ).toEqual({
      statusLabel: 'Prompt configured',
      versionLabel: 'v7',
      excerpt:
        'Keep orchestration brief, verify outcomes, and prefer explicit recovery steps when work stalls.',
    });
  });

  it('derives orchestrator model posture from override then fallback', () => {
    const assignments: RoleAssignmentRecord[] = [
      {
        role_name: 'orchestrator',
        primary_model_id: 'catalog-openai-gpt54',
        reasoning_config: { effort: 'medium' },
      },
    ];
    const systemDefault: SystemDefaultRecord = {
      modelId: 'system-default',
      reasoningConfig: null,
    };
    expect(
      summarizeOrchestratorModel(assignments, systemDefault, [
        {
          id: 'catalog-openai-gpt54',
          model_id: 'gpt-5.4',
          provider_name: 'OpenAI (Subscription)',
          is_enabled: true,
        },
      ]),
    ).toEqual({
      modelLabel: 'gpt-5.4 (OpenAI (Subscription))',
      reasoningLabel: 'effort: medium',
      sourceLabel: 'Orchestrator override',
    });
  });

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
            runtime_image: 'ghcr.io/agisnap/orchestrator:latest',
            cpu_limit: '1',
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
      runtimeLabel: 'ghcr.io/agisnap/orchestrator:latest',
      modelLabel: 'gpt-5.4',
    });
  });

  it('formats empty reasoning config safely', () => {
    expect(summarizeReasoningConfig(null)).toBe('No explicit reasoning profile');
    expect(summarizeReasoningConfig({ thinking_level: 'medium' })).toBe(
      'thinking_level: medium',
    );
  });

  it('reports orchestrator setup blockers with explicit recovery guidance', () => {
    expect(
      summarizeOrchestratorReadiness(
        summarizeOrchestratorPrompt(undefined),
        summarizeOrchestratorModel([], { modelId: null, reasoningConfig: null }, []),
        {
          desiredWorkers: 0,
          desiredReplicas: 0,
          enabledWorkers: 0,
          runningContainers: 0,
          runtimeLabel: 'Use worker desired state',
          modelLabel: 'Inherited from LLM assignments',
        },
      ),
    ).toEqual({
      headline: 'Needs attention',
      detail: 'Resolve these orchestrator setup blockers before relying on this control plane for live workflows.',
      issues: [
        {
          id: 'prompt',
          title: 'Add the orchestrator baseline prompt.',
          detail: 'Operators should activate a platform-instructions version before new workflows depend on orchestration decisions.',
        },
        {
          id: 'model',
          title: 'Assign an orchestrator model.',
          detail: 'Choose a system default or orchestrator override so the control plane does not rely on an unset model route.',
        },
        {
          id: 'pool',
          title: 'Enable the orchestrator worker pool.',
          detail: 'Set at least one enabled worker with desired replicas so orchestrator tasks have capacity to run.',
        },
      ],
      isReady: false,
    });
  });

  it('marks the control plane ready when prompt, model, and pool posture are configured', () => {
    expect(
      summarizeOrchestratorReadiness(
        {
          statusLabel: 'Prompt configured',
          versionLabel: 'v3',
          excerpt: 'Coordinate work and request review when a stage gate requires it.',
        },
        {
          modelLabel: 'gpt-5.4 (OpenAI)',
          reasoningLabel: 'effort: medium',
          sourceLabel: 'System default',
        },
        {
          desiredWorkers: 1,
          desiredReplicas: 2,
          enabledWorkers: 1,
          runningContainers: 1,
          runtimeLabel: 'ghcr.io/agirunner/runtime:latest',
          modelLabel: 'gpt-5.4',
        },
      ),
    ).toEqual({
      headline: 'Control plane ready',
      detail: 'Prompt, model routing, and worker pool posture are configured for live orchestration.',
      issues: [],
      isReady: true,
    });
  });
});
