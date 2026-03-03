/**
 * Polling utilities for live test scenarios.
 *
 * Provides generic poll-until-condition helpers used by all scenarios
 * to wait for pipelines, tasks, and workers to reach expected states.
 */

import type { ApiPipeline, ApiTask, LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  label: string;
}

function elapsedSeconds(startedAt: number): string {
  return `${Math.round((Date.now() - startedAt) / 1000)}s`;
}

export async function pollUntilValue<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: PollOptions,
): Promise<T> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? config.taskTimeoutMs;
  const intervalMs = options.intervalMs ?? config.pollIntervalMs;
  let lastValue: T | undefined;

  while (Date.now() - started < timeoutMs) {
    lastValue = await read();
    if (done(lastValue)) {
      return lastValue;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `${options.label} not reached within ${elapsedSeconds(started)} (timeout=${timeoutMs}ms)` +
      `${lastValue === undefined ? '' : `. Last value: ${JSON.stringify(lastValue)}`}`,
  );
}

export async function pollUntilCondition(
  check: () => Promise<boolean>,
  options: PollOptions,
): Promise<void> {
  await pollUntilValue(check, (value) => value, options);
}

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
  const pipeline = await pollUntilValue(
    () => client.getPipeline(pipelineId),
    (value) => expectedStates.includes(value.state),
    {
      timeoutMs,
      intervalMs: config.pollIntervalMs,
      label: `Pipeline ${pipelineId} expected state [${expectedStates.join(', ')}]`,
    },
  );

  return pipeline;
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
  const task = await pollUntilValue(
    () => client.getTask(taskId),
    (value) => expectedStates.includes(value.state),
    {
      timeoutMs,
      intervalMs: config.pollIntervalMs,
      label: `Task ${taskId} expected state [${expectedStates.join(', ')}]`,
    },
  );

  return task;
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
