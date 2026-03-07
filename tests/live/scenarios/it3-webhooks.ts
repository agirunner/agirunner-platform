import pg from 'pg';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { loadConfig } from '../config.js';
import { createTenantBootstrap } from './tenant.js';

const config = loadConfig();

function parseStatusCodeFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/ returned (\d+):/);
  return match ? Number(match[1]) : null;
}

async function expectHttpStatus(
  label: string,
  expectedStatus: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected ${label} to fail with HTTP ${expectedStatus}, but request succeeded`);
  } catch (error) {
    const status = parseStatusCodeFromError(error);
    if (status !== expectedStatus) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Expected ${label} to fail with HTTP ${expectedStatus}, got ${status ?? 'unknown'} (${message})`,
      );
    }
  }
}

export async function runIt3Webhooks(_live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('it3-webhooks');
  const validations: string[] = [];

  try {
    const created = (await tenant.adminClient.registerWebhook({
      url: 'https://example.com/hooks/agirunner',
      event_types: ['task.completed', 'workflow.completed'],
      secret: 'very-secret-webhook-key',
    })) as { id: string; url: string; event_types: string[]; is_active: boolean; secret: string };

    validations.push('webhook_registered');

    if (!created.id || created.url !== 'https://example.com/hooks/agirunner') {
      throw new Error('IT-3 webhook registration returned invalid payload');
    }

    const listed = (await tenant.adminClient.listWebhooks()) as Array<{ id: string; is_active: boolean }>;

    const found = listed.find((hook) => hook.id === created.id);
    if (!found) {
      throw new Error('IT-3 webhook was not listed after registration');
    }
    validations.push('webhook_listed');

    const pool = new pg.Pool({ connectionString: config.postgresUrl });
    try {
      const row = await pool.query<{ secret: string }>('SELECT secret FROM webhooks WHERE tenant_id = $1 AND id = $2', [
        tenant.tenantId,
        created.id,
      ]);

      if (row.rowCount !== 1) {
        throw new Error('IT-3 DB verification failed: webhook row not found');
      }

      const storedSecret = row.rows[0].secret;
      if (storedSecret === 'very-secret-webhook-key') {
        throw new Error('IT-3 expected encrypted webhook secret at rest, found plaintext');
      }
      validations.push('webhook_secret_encrypted_at_rest');
    } finally {
      await pool.end();
    }

    await expectHttpStatus('invalid webhook URL', 400, () =>
      tenant.adminClient.registerWebhook({
        url: 'ftp://invalid-hook-url',
        event_types: ['task.completed'],
      }),
    );
    validations.push('invalid_webhook_input_rejected');

    await tenant.adminClient.deleteWebhook(created.id);
    validations.push('webhook_deleted');
  } finally {
    await tenant.cleanup();
  }

  return {
    name: 'it3-webhooks',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
