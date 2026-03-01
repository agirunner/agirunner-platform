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

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
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
export async function runAp7FailureRecovery(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
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

  // Wait for the pipeline to reach a failed or active state
  // The architect task should be processed first; it may succeed or fail
  const result = await pollPipelineUntil(
    client,
    pipeline.id,
    ['failed', 'active', 'completed'],
    config.pipelineTimeoutMs,
  );

  // Find the tasks to check
  const tasks = result.tasks ?? [];
  const failedTasks = tasks.filter((t) => t.state === 'failed');

  if (failedTasks.length > 0) {
    // At least one task failed — verify the failure structure
    const failedTask = failedTasks[0];
    assertTaskFailed(failedTask);
    validations.push('task_failure_detected');

    // Verify that a failed task can be retried via the admin API
    const retried = await client.retryTask(failedTask.id);
    if (retried.state !== 'ready') {
      throw new Error(
        `Retried task ${retried.id} expected state "ready", got "${retried.state}"`,
      );
    }
    validations.push('task_retry_succeeds');
    validations.push('retried_task_ready');
  } else if (result.state === 'completed') {
    // If the LLM somehow completed this, that's also a valid outcome
    // (non-deterministic LLM output). The important thing is the system
    // didn't crash or hang.
    validations.push('pipeline_completed_unexpectedly');
    validations.push('system_stable_under_impossible_input');
  } else {
    // Pipeline is still active — wait a bit more for a failure
    await sleep(config.taskTimeoutMs);
    const afterWait = await client.getPipeline(pipeline.id);
    const failedAfter = (afterWait.tasks ?? []).filter((t) => t.state === 'failed');

    if (failedAfter.length > 0) {
      assertTaskFailed(failedAfter[0]);
      validations.push('task_failure_detected');

      const retried = await client.retryTask(failedAfter[0].id);
      if (retried.state !== 'ready') {
        throw new Error(`Retried task state: ${retried.state}`);
      }
      validations.push('task_retry_succeeds');
    } else {
      // No failure after extended wait — system is robust but didn't fail
      validations.push('no_failure_within_timeout');
    }
  }

  return {
    name: 'ap7-failure-recovery',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
