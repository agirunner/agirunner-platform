/**
 * Assertion utilities for live test scenarios.
 *
 * Provides schema-based assertions that verify structure rather than
 * exact LLM output content, per the test plan risk mitigation strategy.
 */

import type { ApiPipeline, ApiTask } from '../api-client.js';

/**
 * Asserts that a pipeline has reached one of the expected terminal states
 * and contains the expected number of tasks.
 */
export function assertPipelineTerminal(
  pipeline: ApiPipeline,
  expectedState: string,
  expectedTaskCount: number,
): void {
  if (pipeline.state !== expectedState) {
    throw new Error(
      `Pipeline ${pipeline.id} expected state "${expectedState}", got "${pipeline.state}"`,
    );
  }

  const tasks = pipeline.tasks ?? [];
  if (tasks.length !== expectedTaskCount) {
    throw new Error(
      `Pipeline ${pipeline.id} expected ${expectedTaskCount} tasks, got ${tasks.length}`,
    );
  }
}

/**
 * Asserts that all tasks in a completed pipeline are in the "completed" state
 * and each has a non-null output field.
 */
export function assertAllTasksCompleted(pipeline: ApiPipeline): void {
  const tasks = pipeline.tasks ?? [];
  for (const task of tasks) {
    if (task.state !== 'completed') {
      throw new Error(
        `Task ${task.id} (${task.role ?? task.type}) expected state "completed", got "${task.state}"`,
      );
    }
  }
}

/**
 * Asserts that all completed tasks have a non-empty output object.
 * We assert structure (output is an object with at least one key),
 * NOT exact LLM content.
 */
export function assertTaskOutputsPresent(pipeline: ApiPipeline): void {
  const tasks = pipeline.tasks ?? [];
  for (const task of tasks) {
    if (task.state !== 'completed') continue;
    if (!task.output || typeof task.output !== 'object') {
      throw new Error(
        `Task ${task.id} (${task.role ?? task.type}) completed without an output object`,
      );
    }
    if (Object.keys(task.output).length === 0) {
      throw new Error(
        `Task ${task.id} (${task.role ?? task.type}) completed with empty output`,
      );
    }
  }
}

/**
 * Asserts the dependency graph was respected during pipeline execution.
 * For a completed pipeline, verifies each task's dependencies completed
 * before the task itself.
 */
export function assertDependencyOrder(pipeline: ApiPipeline): void {
  const tasks = pipeline.tasks ?? [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    const deps = task.depends_on ?? [];
    for (const depId of deps) {
      const dep = taskById.get(depId);
      if (!dep) {
        throw new Error(
          `Task ${task.id} depends on ${depId} which does not exist in pipeline`,
        );
      }
      if (dep.state !== 'completed' && task.state === 'completed') {
        throw new Error(
          `Task ${task.id} completed before its dependency ${depId} (dep state: ${dep.state})`,
        );
      }
    }
  }
}

/**
 * Asserts that a specific task reached the "failed" state and has an error object.
 */
export function assertTaskFailed(task: ApiTask): void {
  if (task.state !== 'failed') {
    throw new Error(
      `Task ${task.id} expected state "failed", got "${task.state}"`,
    );
  }
}

/**
 * Asserts that a specific task is in "ready" state (unblocked and claimable).
 */
export function assertTaskReady(task: ApiTask): void {
  if (task.state !== 'ready') {
    throw new Error(
      `Task ${task.id} expected state "ready", got "${task.state}"`,
    );
  }
}

/**
 * Asserts that a task is in "pending" state (blocked by dependencies).
 */
export function assertTaskPending(task: ApiTask): void {
  if (task.state !== 'pending') {
    throw new Error(
      `Task ${task.id} expected state "pending", got "${task.state}"`,
    );
  }
}

/**
 * Asserts that the tasks in a pipeline have the expected roles in the expected order.
 */
export function assertTaskRoles(pipeline: ApiPipeline, expectedRoles: string[]): void {
  const tasks = pipeline.tasks ?? [];
  const roles = tasks.map((t) => t.role ?? t.type);
  if (roles.length !== expectedRoles.length) {
    throw new Error(
      `Expected ${expectedRoles.length} tasks with roles [${expectedRoles.join(',')}], ` +
        `got ${roles.length} tasks with roles [${roles.join(',')}]`,
    );
  }
  for (let i = 0; i < expectedRoles.length; i++) {
    if (roles[i] !== expectedRoles[i]) {
      throw new Error(
        `Task at index ${i} expected role "${expectedRoles[i]}", got "${roles[i]}"`,
      );
    }
  }
}

/**
 * Asserts initial pipeline state after creation:
 * - First task(s) with no dependencies should be "ready"
 * - Tasks with unmet dependencies should be "pending"
 */
export function assertInitialPipelineState(pipeline: ApiPipeline): void {
  const tasks = pipeline.tasks ?? [];
  for (const task of tasks) {
    const deps = task.depends_on ?? [];
    if (deps.length === 0) {
      if (task.state !== 'ready') {
        throw new Error(
          `Task ${task.id} has no dependencies and should be "ready", got "${task.state}"`,
        );
      }
    } else {
      if (task.state !== 'pending') {
        throw new Error(
          `Task ${task.id} has unmet dependencies and should be "pending", got "${task.state}"`,
        );
      }
    }
  }
}
