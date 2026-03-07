/**
 * Maintenance Sad Path — tests workflow cancellation and cleanup.
 *
 * Creates a maintenance workflow and immediately cancels it,
 * verifying the orchestrator correctly transitions all tasks.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { LiveApiClient } from '../api-client.js';
import { maintenanceTemplateSchema } from './templates.js';
import { pollUntilValue } from './poll.js';

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

  // Create workflow
  const workflow = await client.createWorkflow({
    template_id: template.id,
    name: `Maint-sad workflow ${live.runId}`,
    parameters: {
      repo: 'todo-app',
      issue: 'cancel-test',
      description: 'Test cancellation of maintenance workflow',
    },
  });
  validations.push('workflow_created');

  // Immediately cancel
  const cancelled = await client.cancelWorkflow(workflow.id);
  if (cancelled.state !== 'cancelled') {
    throw new Error(`Expected cancelled, got ${cancelled.state}`);
  }
  validations.push('workflow_cancelled');

  // Verify all tasks are cancelled
  const snapshot = await pollUntilValue(
    () => client.getWorkflow(workflow.id),
    (value) => (value.tasks ?? []).every((task) => task.state === 'cancelled'),
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      label: `maintenance-sad workflow ${workflow.id} tasks cancelled`,
    },
  );

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
