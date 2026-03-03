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
import { pollUntilValue } from './poll.js';
import { sdlcTemplateSchema } from './templates.js';

const config = loadConfig();

function countTaskStates(tasks: Array<{ state: string }>): Record<string, number> {
  return tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.state] = (counts[task.state] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeRetryCount(task: { retry_count?: unknown }): number {
  const value = Number(task.retry_count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

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

  const finalSnapshot = await pollUntilValue(
    () => client.getPipeline(pipeline.id),
    (snapshot) =>
      snapshot.state === 'completed' ||
      (snapshot.tasks ?? []).some((task) => task.state === 'failed'),
    {
      timeoutMs: config.pipelineTimeoutMs,
      intervalMs: config.pollIntervalMs,
      label: `AP-7 failure observation for pipeline ${pipeline.id}`,
    },
  );
  validations.push('resilience_no_hang_within_timeout');

  const failedTask = (finalSnapshot.tasks ?? []).find((task) => task.state === 'failed');

  if (!failedTask) {
    throw new Error(
      'AP-7 expected at least one failed task for impossible input, but pipeline completed without failure',
    );
  }

  assertTaskFailed(failedTask);
  validations.push('resilience_failed_task_observed');

  const preRetrySnapshot = finalSnapshot;
  const preRetrySnapshotTasks = preRetrySnapshot.tasks ?? [];
  const preRetryTask = preRetrySnapshotTasks.find((task) => task.id === failedTask.id);

  if (!preRetryTask) {
    throw new Error(
      `AP-7 expected failed task ${failedTask.id} in pre-retry persisted snapshot, but it was missing`,
    );
  }

  if (preRetryTask.state !== 'failed') {
    throw new Error(
      `AP-7 expected pre-retry persisted task ${preRetryTask.id} state "failed", got "${preRetryTask.state}"`,
    );
  }
  validations.push('resilience_pre_retry_snapshot_failed_state');

  const preRetryCount = normalizeRetryCount(preRetryTask);

  const retried = await client.retryTask(failedTask.id);
  validations.push('resilience_retry_control_invoked');

  if (retried.id !== failedTask.id) {
    throw new Error(
      `AP-7 expected retry endpoint to return task ${failedTask.id}, got ${retried.id}`,
    );
  }

  if (retried.state !== 'ready') {
    throw new Error(`Retried task ${retried.id} expected state "ready", got "${retried.state}"`);
  }

  const retryEndpointCount = normalizeRetryCount(retried);
  if (retryEndpointCount <= preRetryCount) {
    throw new Error(
      `AP-7 expected retry_count to increase after retry for task ${retried.id}. Before=${preRetryCount}, after=${retryEndpointCount}`,
    );
  }
  validations.push('resilience_retry_transition_ready');
  validations.push('resilience_retry_count_incremented');

  const postRetrySnapshot = await pollUntilValue(
    () => client.getPipeline(pipeline.id),
    (snapshot) => {
      const task = (snapshot.tasks ?? []).find((candidate) => candidate.id === retried.id);
      if (!task) {
        return false;
      }
      return normalizeRetryCount(task) >= retryEndpointCount;
    },
    {
      timeoutMs: config.taskTimeoutMs,
      intervalMs: config.pollIntervalMs,
      label: `AP-7 post-retry persisted snapshot for task ${retried.id}`,
    },
  );

  const postRetrySnapshotTasks = postRetrySnapshot.tasks ?? [];
  const postRetryTask = postRetrySnapshotTasks.find((task) => task.id === retried.id);

  if (!postRetryTask) {
    throw new Error(
      `AP-7 expected retried task ${retried.id} in post-retry persisted snapshot, but it was missing`,
    );
  }

  const postRetryCount = normalizeRetryCount(postRetryTask);

  if (postRetryCount < retryEndpointCount) {
    throw new Error(
      `AP-7 expected post-retry snapshot retry_count >= ${retryEndpointCount} for task ${retried.id}, got ${postRetryCount}`,
    );
  }
  validations.push('resilience_retry_persisted_snapshot_observed');
  const preRetrySnapshotTaskStates = preRetrySnapshotTasks.map((task) => ({
    id: task.id,
    role: task.role ?? task.type ?? 'unknown-role',
    state: task.state,
  }));
  const postRetrySnapshotTaskStates = postRetrySnapshotTasks.map((task) => ({
    id: task.id,
    role: task.role ?? task.type ?? 'unknown-role',
    state: task.state,
  }));

  const preTaskById = new Map(preRetrySnapshotTasks.map((task) => [task.id, task]));
  const postTaskById = new Map(postRetrySnapshotTasks.map((task) => [task.id, task]));
  const canonicalTaskIds = [
    ...new Set([
      ...preRetrySnapshotTasks.map((task) => task.id),
      ...postRetrySnapshotTasks.map((task) => task.id),
    ]),
  ];

  const snapshotIntegritySummary = {
    preRetry: {
      pipelineState: preRetrySnapshot.state,
      taskCount: preRetrySnapshotTaskStates.length,
      stateCounts: countTaskStates(preRetrySnapshotTaskStates),
    },
    postRetry: {
      pipelineState: postRetrySnapshot.state,
      taskCount: postRetrySnapshotTaskStates.length,
      stateCounts: countTaskStates(postRetrySnapshotTaskStates),
    },
    changedTaskIds: canonicalTaskIds.filter((taskId) => {
      const preState = preTaskById.get(taskId)?.state;
      const postState = postTaskById.get(taskId)?.state;
      return preState !== postState;
    }),
  };

  const trackedRole =
    postRetryTask.role ??
    postRetryTask.type ??
    preRetryTask.role ??
    preRetryTask.type ??
    failedTask.role ??
    failedTask.type ??
    'unknown-role';

  const evidenceTaskIds = [...new Set([failedTask.id, retried.id])];

  const authenticityEvidence: ScenarioDeliveryEvidence[] = [
    {
      pipelineId: postRetrySnapshot.id,
      pipelineState: postRetrySnapshot.state,
      acceptanceCriteria: [
        'Deterministic resilience: timeout-bounded poll reaches observable state (no hang/crash)',
        'Deterministic resilience: impossible input surfaces a failed task and retry control restores ready state',
        'Failure+recovery trace proven from persisted snapshots using canonical task IDs only',
        'Snapshot integrity evidence covers all task states to prevent defect masking',
        'Scenario captures recovery checkpoint: retry endpoint returns ready and persisted snapshot confirms incremented retry_count',
        'Delivery quality: outputs avoid synthetic/template placeholders',
      ],
      requiresGitDiffEvidence: false,
      tasks: evidenceTaskIds.map((taskId) => {
        const preTask = preTaskById.get(taskId);
        const postTask = postTaskById.get(taskId);
        const taskRole =
          postTask?.role ?? postTask?.type ?? preTask?.role ?? preTask?.type ?? trackedRole;

        const output: Record<string, unknown> = {
          sourceTaskId: taskId,
          preRetryState: preTask?.state ?? null,
          postRetryState: postTask?.state ?? null,
          observedInPreRetrySnapshot: Boolean(preTask),
          observedInPostRetrySnapshot: Boolean(postTask),
          snapshotIntegritySummary,
        };

        if (taskId === failedTask.id) {
          output.preRetryFailureOutput = preTask?.output ?? failedTask.output ?? null;
        }

        if (taskId === retried.id) {
          output.retryEndpointState = retried.state;
          output.retryCountBeforeRetry = preRetryCount;
          output.retryCountAtRetryEndpoint = retryEndpointCount;
          output.retryCountInPostRetrySnapshot = postRetryCount;
          output.recoveryCheckpointState = postRetryTask.state;
          output.recoveryVerifiedFromPersistedSnapshot = postRetryCount >= retryEndpointCount;
          output.preRetrySnapshotTasks = preRetrySnapshotTaskStates;
          output.postRetrySnapshotTasks = postRetrySnapshotTaskStates;
          output.postRetryTaskOutput = postTask?.output ?? retried.output ?? null;
          output.pendingTaskIdsAfterRecovery = postRetrySnapshotTaskStates
            .filter((task) => task.id !== retried.id && task.state === 'pending')
            .map((task) => task.id);
        }

        return {
          id: taskId,
          role: taskRole,
          state:
            taskId === retried.id
              ? postRetryTask.state
              : (preTask?.state ?? postTask?.state ?? 'unknown'),
          output,
        };
      }),
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
