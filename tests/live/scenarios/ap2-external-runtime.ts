/**
 * AP-2: External Worker SDLC Pipeline
 *
 * The live test harness acts as the external worker runtime:
 * - registers a polling external worker
 * - registers an agent identity bound to that worker
 * - claims tasks via /tasks/claim
 * - executes lifecycle transitions via agent-scoped key (start -> complete)
 *
 * Test plan ref: AP-2
 */

import type { LiveContext, ScenarioDeliveryEvidence, ScenarioExecutionResult } from '../harness/types.js';
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
const EXTERNAL_CAPABILITIES = [
  'llm-api',
  'role:architect',
  'role:developer',
  'role:reviewer',
  'role:qa',
  'lang:typescript',
  'lang:python',
  'lang:go',
];

export async function runAp2ExternalRuntime(live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('ap2-external-runtime');
  const validations: string[] = [];
  let externalWorkerId: string | undefined;
  let authenticityEvidence: ScenarioDeliveryEvidence[] = [];

  try {
    const registered = await registerWorkerAgent(tenant, {
      workerName: `ap2-external-worker-${live.runId}`,
      workerCapabilities: EXTERNAL_CAPABILITIES,
      agentName: `ap2-external-agent-${live.runId}`,
      agentCapabilities: EXTERNAL_CAPABILITIES,
      connectionMode: 'polling',
      runtimeType: 'external',
    });

    externalWorkerId = registered.workerId;
    const externalHarness: HarnessWorker = {
      label: 'ap2-external-worker',
      workerId: registered.workerId,
      agentId: registered.agentId,
      capabilities: EXTERNAL_CAPABILITIES,
      agentClient: registered.agentClient,
    };

    validations.push('external_worker_registered');
    validations.push('external_agent_registered');

    const tenantWorkers = await tenant.adminClient.listWorkers();
    const builtInWorkers = tenantWorkers.filter(
      (worker) => worker.runtime_type === 'internal' || worker.runtime_type === 'built_in',
    );
    if (builtInWorkers.length !== 0) {
      throw new Error(
        `AP-2 tenant unexpectedly has built-in workers: ${builtInWorkers.map((worker) => worker.id).join(', ')}`,
      );
    }
    validations.push('built_in_not_present_for_tenant');

    const template = await tenant.adminClient.createTemplate({
      name: `AP-2 SDLC ${live.runId}`,
      slug: `ap2-sdlc-${live.runId}`,
      schema: sdlcTemplateSchema(),
    });
    validations.push('template_created');

    const pipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `AP-2 calc-api ${live.runId}`,
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
      const claimed = await claimTaskWithPolling(externalHarness, pipeline.id);

      if (claimed.role !== expectedRole) {
        throw new Error(`Expected ${expectedRole} task, claimed ${claimed.role ?? claimed.type}`);
      }

      if (claimed.assigned_worker_id && claimed.assigned_worker_id !== externalHarness.workerId) {
        throw new Error(
          `Task ${claimed.id} assigned_worker_id ${claimed.assigned_worker_id} did not match external worker ${externalHarness.workerId}`,
        );
      }

      await startAndCompleteTask(externalHarness, claimed, 'ap2-external-runtime');
      handledRoles.push(claimed.role ?? claimed.type);
      validations.push(`task_completed:${expectedRole}`);
    }

    if (handledRoles.join(',') !== SDLC_ROLES.join(',')) {
      throw new Error(`Unexpected role handling order: ${handledRoles.join(', ')}`);
    }
    validations.push('routing_all_tasks_external');

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

    authenticityEvidence = [
      {
        pipelineId: completed.id,
        pipelineState: completed.state,
        acceptanceCriteria: [
          'All SDLC roles complete in sequence under external runtime mode',
          'Each completed task output carries deterministic synthetic signature fields',
          'No built-in worker participates in isolated AP-2 tenant execution',
        ],
        requiresGitDiffEvidence: false,
        tasks: (completed.tasks ?? []).map((task) => ({
          id: task.id,
          role: task.role ?? task.type,
          state: task.state,
          output: task.output ?? null,
        })),
      },
    ];

    await tenant.adminClient.deleteWorker(externalHarness.workerId);
    await assertWorkerRemoved(tenant.adminClient, externalHarness.workerId);
    validations.push('external_worker_deregistered');
  } finally {
    if (externalWorkerId) {
      const workers = await tenant.adminClient.listWorkers();
      const stillPresent = workers.some((worker) => workerMatches(worker, externalWorkerId));
      if (stillPresent) {
        await tenant.adminClient.deleteWorker(externalWorkerId);
      }
    }
    await tenant.cleanup();
  }

  return {
    name: 'ap2-external-runtime',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
    authenticityEvidence,
  };
}
