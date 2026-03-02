import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import {
  assertAllTasksCompleted,
  assertDependencyOrder,
  assertInitialPipelineState,
  assertPipelineTerminal,
  assertTaskOutputsPresent,
  assertTaskRoles,
} from './assertions.js';
import {
  assertWorkerRemoved,
  claimTaskWithPolling,
  startAndCompleteTask,
  type HarnessWorker,
  workerMatches,
} from './external-worker-utils.js';
import { loadConfig } from '../config.js';
import { pollPipelineUntil } from './poll.js';
import { sdlcTemplateSchema } from './templates.js';
import { createTenantBootstrap, registerWorkerAgent } from './tenant.js';

const config = loadConfig();

const SDLC_ROLES = ['architect', 'developer', 'reviewer', 'qa'];
const STANDALONE_CAPABILITIES = [
  'llm-api',
  'role:architect',
  'role:developer',
  'role:reviewer',
  'role:qa',
  'lang:typescript',
  'lang:python',
  'lang:go',
];

export async function runAp3StandaloneWorker(live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('ap3-standalone-worker');
  const validations: string[] = [];
  let standaloneWorkerId: string | undefined;

  try {
    const registered = await registerWorkerAgent(tenant, {
      workerName: `ap3-standalone-worker-${live.runId}`,
      workerCapabilities: STANDALONE_CAPABILITIES,
      agentName: `ap3-standalone-agent-${live.runId}`,
      agentCapabilities: STANDALONE_CAPABILITIES,
      connectionMode: 'polling',
      runtimeType: 'custom',
    });

    standaloneWorkerId = registered.workerId;
    const worker: HarnessWorker = {
      label: 'ap3-standalone-worker',
      workerId: registered.workerId,
      agentId: registered.agentId,
      capabilities: STANDALONE_CAPABILITIES,
      agentClient: registered.agentClient,
    };

    validations.push('standalone_worker_registered');
    validations.push('standalone_agent_registered');

    const template = await tenant.adminClient.createTemplate({
      name: `AP-3 SDLC ${live.runId}`,
      slug: `ap3-sdlc-${live.runId}`,
      schema: sdlcTemplateSchema(),
    });
    validations.push('template_created');

    const pipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `AP-3 calc-api ${live.runId}`,
      parameters: {
        repo: 'calc-api',
        goal: 'Add a multiply endpoint to the calculator API',
      },
    });
    validations.push('pipeline_created');

    assertTaskRoles(pipeline, SDLC_ROLES);
    assertInitialPipelineState(pipeline);
    validations.push('initial_state_valid');

    const handledRoles: string[] = [];

    for (const expectedRole of SDLC_ROLES) {
      const claimed = await claimTaskWithPolling(worker, pipeline.id);

      if (claimed.role !== expectedRole) {
        throw new Error(`Expected ${expectedRole} task, claimed ${claimed.role ?? claimed.type}`);
      }

      await registered.workerClient.heartbeat(worker.workerId, {
        status: 'busy',
        current_task_id: claimed.id,
      });

      await startAndCompleteTask(worker, claimed, 'ap3-standalone-worker');
      handledRoles.push(claimed.role ?? claimed.type);
      validations.push(`task_completed:${expectedRole}`);
    }

    if (handledRoles.join(',') !== SDLC_ROLES.join(',')) {
      throw new Error(`Unexpected role handling order: ${handledRoles.join(', ')}`);
    }

    const completed = await pollPipelineUntil(
      tenant.adminClient,
      pipeline.id,
      ['completed', 'failed'],
      config.pipelineTimeoutMs,
    );

    assertPipelineTerminal(completed, 'completed', 4);
    assertAllTasksCompleted(completed);
    assertTaskOutputsPresent(completed);
    assertDependencyOrder(completed);
    validations.push('pipeline_completed');

    await tenant.adminClient.deleteWorker(worker.workerId);
    await assertWorkerRemoved(tenant.adminClient, worker.workerId);
    validations.push('standalone_worker_deregistered');
  } finally {
    if (standaloneWorkerId) {
      const workers = await tenant.adminClient.listWorkers();
      const stillPresent = workers.some((worker) => workerMatches(worker, standaloneWorkerId!));
      if (stillPresent) {
        await tenant.adminClient.deleteWorker(standaloneWorkerId);
      }
    }
    await tenant.cleanup();
  }

  return {
    name: 'ap3-standalone-worker',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
