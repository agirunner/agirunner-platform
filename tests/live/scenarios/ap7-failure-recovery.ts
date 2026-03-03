/**
 * AP-7: Pipeline Failure and Autonomous Recovery
 *
 * Tests failure handling and manual retry:
 * 1. Creates an SDLC pipeline with an impossible constraint ("Rewrite in Rust")
 * 2. The developer task should fail (can't rewrite Express in Rust)
 * 3. Built-in worker's rework attempts should be exhausted
 * 4. Test harness retries with modified input
 * 5. Verifies the task can be retried
 *
 * Test plan ref: Section 2, AP-7
 * FR refs: FR-006, FR-019, FR-036, FR-749
 */

import type {
  LiveContext,
  ScenarioDeliveryEvidence,
  ScenarioExecutionResult,
} from '../harness/types.js';
import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import { assertTaskFailed } from './assertions.js';
import { pollPipelineUntil, pollTaskUntil, sleep } from './poll.js';
import { sdlcTemplateSchema } from './templates.js';

const config = loadConfig();

/**
 * Runs the AP-7 scenario: pipeline failure and recovery.
 *
 * This scenario triggers a failure by giving the system a task it cannot
 * accomplish, then tests the retry mechanism.
 */
export async function runAp7FailureRecovery(live: LiveContext): Promise<ScenarioExecutionResult> {
  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const validations: string[] = [];

  // Create SDLC template
  const template = await client.createTemplate({
    name: `AP-7 Failure ${live.runId}`,
    slug: `ap7-fail-${live.runId}`,
    schema: sdlcTemplateSchema(),
  });
  validations.push('template_created');

  // Create pipeline with impossible constraint
  const pipeline = await client.createPipeline({
    template_id: template.id,
    name: `AP-7 impossible ${live.runId}`,
    parameters: {
      repo: 'calc-api',
      goal: 'Rewrite the entire Express calculator application in Rust with no JavaScript',
    },
  });
  validations.push('pipeline_created');

  // Wait for the pipeline to reach a failed or active state.
  // AP-7 expects a real failure path followed by retry; "completed" is invalid.
  const result = await pollPipelineUntil(
    client,
    pipeline.id,
    ['failed', 'active', 'completed'],
    config.pipelineTimeoutMs,
  );

  let finalSnapshot = result;

  if (result.state === 'completed') {
    throw new Error(
      'AP-7 expected at least one failed task for impossible input, but pipeline completed without failure',
    );
  }

  let failedTask = (result.tasks ?? []).find((task) => task.state === 'failed');

  if (!failedTask) {
    // Pipeline may still be active while failure converges; wait once more then enforce.
    await sleep(config.pollIntervalMs * 3);
    const afterWait = await client.getPipeline(pipeline.id);
    finalSnapshot = afterWait;
    failedTask = (afterWait.tasks ?? []).find((task) => task.state === 'failed');
  }

  if (!failedTask) {
    throw new Error('AP-7 expected a failed task, but no failed task was observed before timeout');
  }

  assertTaskFailed(failedTask);
  validations.push('task_failure_detected');

  const retried = await client.retryTask(failedTask.id);
  if (retried.state !== 'ready') {
    throw new Error(`Retried task ${retried.id} expected state "ready", got "${retried.state}"`);
  }
  validations.push('task_retry_succeeds');
  validations.push('retried_task_ready');

  const authenticityEvidence: ScenarioDeliveryEvidence[] = [
    {
      pipelineId: finalSnapshot.id,
      pipelineState: finalSnapshot.state,
      acceptanceCriteria: [
        'Failure behavior is explicit for impossible input (at least one task failed)',
        'Retry flow transitions failed task back to ready',
        'No synthetic/template placeholders in produced outputs',
      ],
      requiresGitDiffEvidence: false,
      tasks: (finalSnapshot.tasks ?? []).map((task) => ({
        id: task.id,
        role: task.role ?? task.type,
        state: task.state,
        output: task.output ?? null,
      })),
    },
  ];

  return {
    name: 'ap7-failure-recovery',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
    authenticityEvidence,
  };
}
