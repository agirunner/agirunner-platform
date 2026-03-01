/**
 * Maintenance Sad Path — tests pipeline cancellation and cleanup.
 *
 * Creates a maintenance pipeline and immediately cancels it,
 * verifying the orchestrator correctly transitions all tasks.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import { maintenanceTemplateSchema } from './templates.js';
import { sleep } from './poll.js';

const config = loadConfig();

export async function runMaintenanceSadScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const validations: string[] = [];

  // Create template
  const template = await client.createTemplate({
    name: `Maint-sad ${live.runId}`,
    slug: `maint-sad-${live.runId}`,
    schema: maintenanceTemplateSchema(),
  });
  validations.push('template_created');

  // Create pipeline
  const pipeline = await client.createPipeline({
    template_id: template.id,
    name: `Maint-sad pipeline ${live.runId}`,
    parameters: {
      repo: 'todo-app',
      issue: 'cancel-test',
      description: 'Test cancellation of maintenance pipeline',
    },
  });
  validations.push('pipeline_created');

  // Immediately cancel
  const cancelled = await client.cancelPipeline(pipeline.id);
  if (cancelled.state !== 'cancelled') {
    throw new Error(`Expected cancelled, got ${cancelled.state}`);
  }
  validations.push('pipeline_cancelled');

  // Verify all tasks are cancelled
  await sleep(1000);
  const snapshot = await client.getPipeline(pipeline.id);
  const tasks = snapshot.tasks ?? [];
  const allCancelled = tasks.every((t) => t.state === 'cancelled');
  if (!allCancelled) {
    const states = tasks.map((t) => `${t.role}:${t.state}`).join(', ');
    throw new Error(`Not all tasks cancelled: ${states}`);
  }
  validations.push('all_tasks_cancelled');

  return {
    name: 'maintenance-sad',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
