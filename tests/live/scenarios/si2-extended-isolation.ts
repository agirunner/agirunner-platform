/**
 * SI-2: Extended Tenant/Security Isolation
 *
 * Additional path beyond SI-1:
 * - Tenant B must not be able to create a pipeline using Tenant A's template_id.
 *
 * This validates that foreign resource identifiers cannot be reused cross-tenant
 * even when the caller has valid credentials in their own tenant.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTestTenant } from './tenant.js';
import { linearTemplateSchema } from './templates.js';

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

export async function runSi2ExtendedIsolation(
  _live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctxA = await createTestTenant('si2-tenant-a');
  const ctxB = await createTestTenant('si2-tenant-b');
  const validations: string[] = [];

  try {
    const templateA = await ctxA.adminClient.createTemplate({
      name: 'SI2-template-a',
      slug: `si2-a-${Date.now()}`,
      schema: linearTemplateSchema(),
    });
    validations.push('tenant_a_template_created');

    await expectHttpStatus('cross-tenant pipeline create with foreign template_id', 404, () =>
      ctxB.adminClient.createPipeline({
        template_id: templateA.id,
        name: 'si2-cross-tenant-attempt',
      }),
    );
    validations.push('foreign_template_pipeline_create_404');
  } finally {
    await ctxA.cleanup();
    await ctxB.cleanup();
  }

  return {
    name: 'si2-extended-isolation',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
