/**
 * Polling utilities for live test scenarios.
 *
 * Provides generic poll-until-condition helpers used by all scenarios
 * to wait for pipelines, tasks, and workers to reach expected states.
 */

import type { ApiPipeline, ApiTask, LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

/**
 * Polls the pipeline endpoint until the pipeline reaches one of the expected
 * terminal states, or the timeout expires.
 *
 * @returns The pipeline snapshot at the terminal state.
 * @throws If the timeout expires before the pipeline reaches a terminal state.
 */
export async function pollPipelineUntil(
  client: LiveApiClient,
  pipelineId: string,
  expectedStates: string[],
  timeoutMs: number = config.pipelineTimeoutMs,
): Promise<ApiPipeline> {
  const started = Date.now();
  let last: ApiPipeline | undefined;

  while (Date.now() - started < timeoutMs) {
    last = await client.getPipeline(pipelineId);
    if (expectedStates.includes(last.state)) {
      return last;
    }
    await sleep(config.pollIntervalMs);
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  throw new Error(
    `Pipeline ${pipelineId} did not reach [${expectedStates.join(',')}] within ${elapsed}s. ` +
      `Last state: ${last?.state ?? 'unknown'}`,
  );
}

/**
 * Polls the task endpoint until the task reaches one of the expected states.
 */
export async function pollTaskUntil(
  client: LiveApiClient,
  taskId: string,
  expectedStates: string[],
  timeoutMs: number = config.taskTimeoutMs,
): Promise<ApiTask> {
  const started = Date.now();
  let last: ApiTask | undefined;

  while (Date.now() - started < timeoutMs) {
    last = await client.getTask(taskId);
    if (expectedStates.includes(last.state)) {
      return last;
    }
    await sleep(config.pollIntervalMs);
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  throw new Error(
    `Task ${taskId} did not reach [${expectedStates.join(',')}] within ${elapsed}s. ` +
      `Last state: ${last?.state ?? 'unknown'}`,
  );
}

/**
 * Polls the pipeline and returns a snapshot with all task states for inspection.
 */
export async function snapshotPipeline(
  client: LiveApiClient,
  pipelineId: string,
): Promise<{ pipeline: ApiPipeline; taskStates: Record<string, string> }> {
  const pipeline = await client.getPipeline(pipelineId);
  const taskStates: Record<string, string> = {};
  for (const task of pipeline.tasks ?? []) {
    taskStates[task.id] = task.state;
  }
  return { pipeline, taskStates };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
