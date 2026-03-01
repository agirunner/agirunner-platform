import type { ApiTask, ApiWorker, LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import { sleep } from './poll.js';

const config = loadConfig();

export interface HarnessWorker {
  label: string;
  workerId: string;
  agentId: string;
  capabilities: string[];
  agentClient: LiveApiClient;
}

export function workerMatches(worker: ApiWorker, workerId: string): boolean {
  return worker.id === workerId || worker.worker_id === workerId;
}

/**
 * Polls /tasks/claim every config.pollIntervalMs (default 2s) up to
 * config.claimPollTimeoutMs (default 60s) until a task is available.
 */
export async function claimTaskWithPolling(
  worker: HarnessWorker,
  pipelineId: string,
): Promise<ApiTask> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < config.claimPollTimeoutMs) {
    const claimed = await worker.agentClient.claimTask({
      agent_id: worker.agentId,
      worker_id: worker.workerId,
      capabilities: worker.capabilities,
      pipeline_id: pipelineId,
    });

    if (claimed) {
      return claimed;
    }

    await sleep(config.pollIntervalMs);
  }

  throw new Error(
    `No claimable task found for ${worker.label} within ${Math.round(config.claimPollTimeoutMs / 1000)}s`,
  );
}

/**
 * Performs agent-scoped task lifecycle transitions for a claimed task.
 */
export async function startAndCompleteTask(
  worker: HarnessWorker,
  task: ApiTask,
  scenarioName: string,
): Promise<void> {
  if (task.assigned_agent_id && task.assigned_agent_id !== worker.agentId) {
    throw new Error(
      `Task ${task.id} assigned_agent_id ${task.assigned_agent_id} does not match ${worker.agentId}`,
    );
  }

  await worker.agentClient.startTask(task.id, { agent_id: worker.agentId });
  await worker.agentClient.completeTask(task.id, {
    scenario: scenarioName,
    handled_by: worker.label,
    role: task.role ?? task.type,
    task_id: task.id,
    pipeline_id: task.pipeline_id ?? null,
  });
}

export async function assertWorkerRemoved(
  adminClient: LiveApiClient,
  workerId: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < config.claimPollTimeoutMs) {
    const workers = await adminClient.listWorkers();
    if (!workers.some((worker) => workerMatches(worker, workerId))) {
      return;
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error(`Worker ${workerId} still listed after delete request`);
}
