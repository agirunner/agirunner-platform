import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { loadConfig } from '../config.js';
import { createTenantBootstrap, registerWorkerAgent } from './tenant.js';

const config = loadConfig();

async function assertStatus(
  label: string,
  responsePromise: Promise<Response>,
  expected: number,
): Promise<void> {
  const response = await responsePromise;
  if (response.status !== expected) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label}: expected HTTP ${expected}, got ${response.status} (${body})`);
  }
}

export async function runSi2Auth(_live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('si2-auth');
  const validations: string[] = [];

  try {
    await assertStatus(
      'no-auth task list',
      fetch(`${config.apiBaseUrl}/api/v1/tasks`),
      401,
    );
    validations.push('no_auth_401');

    await assertStatus(
      'invalid-key task list',
      fetch(`${config.apiBaseUrl}/api/v1/tasks`, {
        headers: {
          authorization: 'Bearer invalid-api-key',
        },
      }),
      401,
    );
    validations.push('invalid_key_401');

    const pair = await registerWorkerAgent(tenant, {
      workerName: 'si2-auth-worker',
      workerCapabilities: ['llm-api'],
      agentName: 'si2-auth-agent',
      agentCapabilities: ['llm-api'],
      connectionMode: 'polling',
      runtimeType: 'external',
    });

    await assertStatus(
      'wrong-scope worker-key admin endpoint',
      fetch(`${config.apiBaseUrl}/api/v1/webhooks`, {
        headers: {
          authorization: `Bearer ${pair.workerKey}`,
        },
      }),
      403,
    );
    validations.push('wrong_scope_403');

    const health = await fetch(`${config.apiBaseUrl}/health`);
    if (!health.ok) {
      throw new Error(`Expected healthy bootstrap endpoint, got ${health.status}`);
    }
    validations.push('zero_config_bootstrap_health_ok');
  } finally {
    await tenant.cleanup();
  }

  return {
    name: 'si2-auth',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
