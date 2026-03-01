/**
 * AP-4: Mixed Workers — SDLC Pipeline
 *
 * Harness-managed mixed-worker scenario:
 * - Built-in-style worker (runtime_type=internal) handles architect + qa
 * - External worker handles developer + reviewer
 * - Harness claims and completes tasks via each worker's agent key
 *
 * Test plan ref: AP-4
 */

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
const BUILT_IN_CAPABILITIES = ['llm-api', 'role:architect', 'role:qa', 'lang:*'];
const EXTERNAL_CAPABILITIES = ['llm-api', 'role:developer', 'role:reviewer'];

interface RoleRoutingExpectation {
  role: string;
  worker: HarnessWorker;
}

export async function runAp4MixedWorkers(live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('ap4-mixed-workers');
  const validations: string[] = [];
  const workerIdsToCleanup: string[] = [];

  try {
    const builtIn = await registerWorkerAgent(tenant, {
      workerName: `ap4-built-in-worker-${live.runId}`,
      workerCapabilities: BUILT_IN_CAPABILITIES,
      agentName: `ap4-built-in-agent-${live.runId}`,
      agentCapabilities: BUILT_IN_CAPABILITIES,
      connectionMode: 'polling',
      runtimeType: 'internal',
    });
    workerIdsToCleanup.push(builtIn.workerId);

    const external = await registerWorkerAgent(tenant, {
      workerName: `ap4-external-worker-${live.runId}`,
      workerCapabilities: EXTERNAL_CAPABILITIES,
      agentName: `ap4-external-agent-${live.runId}`,
      agentCapabilities: EXTERNAL_CAPABILITIES,
      connectionMode: 'polling',
      runtimeType: 'external',
    });
    workerIdsToCleanup.push(external.workerId);

    const builtInHarness: HarnessWorker = {
      label: 'ap4-built-in-worker',
      workerId: builtIn.workerId,
      agentId: builtIn.agentId,
      capabilities: BUILT_IN_CAPABILITIES,
      agentClient: builtIn.agentClient,
    };

    const externalHarness: HarnessWorker = {
      label: 'ap4-external-worker',
      workerId: external.workerId,
      agentId: external.agentId,
      capabilities: EXTERNAL_CAPABILITIES,
      agentClient: external.agentClient,
    };

    validations.push('built_in_worker_registered');
    validations.push('external_worker_registered');

    const template = await tenant.adminClient.createTemplate({
      name: `AP-4 SDLC ${live.runId}`,
      slug: `ap4-sdlc-${live.runId}`,
      schema: sdlcTemplateSchema(),
    });
    validations.push('template_created');

    const pipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `AP-4 mixed-workers ${live.runId}`,
      parameters: {
        repo: 'calc-api',
        goal: 'Add a multiply endpoint to the calculator API',
      },
    });
    validations.push('pipeline_created');

    assertTaskRoles(pipeline, SDLC_ROLES);
    assertInitialPipelineState(pipeline);
    validations.push('initial_state_valid');

    const routingExpectations: RoleRoutingExpectation[] = [
      { role: 'architect', worker: builtInHarness },
      { role: 'developer', worker: externalHarness },
      { role: 'reviewer', worker: externalHarness },
      { role: 'qa', worker: builtInHarness },
    ];

    const actualRouting = new Map<string, string>();

    for (const expectation of routingExpectations) {
      const claimed = await claimTaskWithPolling(expectation.worker, pipeline.id);

      if (claimed.role !== expectation.role) {
        throw new Error(
          `Expected ${expectation.role} to be claimed by ${expectation.worker.label}, but got ${claimed.role ?? claimed.type}`,
        );
      }

      if (
        claimed.assigned_worker_id &&
        claimed.assigned_worker_id !== expectation.worker.workerId
      ) {
        throw new Error(
          `Task ${claimed.id} (${claimed.role}) assigned worker ${claimed.assigned_worker_id}, expected ${expectation.worker.workerId}`,
        );
      }

      await startAndCompleteTask(expectation.worker, claimed, 'ap4-mixed-workers');
      actualRouting.set(expectation.role, expectation.worker.workerId);
      validations.push(`task_completed:${expectation.role}`);
    }

    if (actualRouting.get('architect') !== builtInHarness.workerId) {
      throw new Error('Architect task was not handled by built-in worker');
    }
    if (actualRouting.get('qa') !== builtInHarness.workerId) {
      throw new Error('QA task was not handled by built-in worker');
    }
    if (actualRouting.get('developer') !== externalHarness.workerId) {
      throw new Error('Developer task was not handled by external worker');
    }
    if (actualRouting.get('reviewer') !== externalHarness.workerId) {
      throw new Error('Reviewer task was not handled by external worker');
    }
    validations.push('routing_verified_mixed_workers');

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

    await tenant.adminClient.deleteWorker(externalHarness.workerId);
    await assertWorkerRemoved(tenant.adminClient, externalHarness.workerId);
    validations.push('external_worker_deregistered');

    await tenant.adminClient.deleteWorker(builtInHarness.workerId);
    await assertWorkerRemoved(tenant.adminClient, builtInHarness.workerId);
    validations.push('built_in_worker_deregistered');
  } finally {
    for (const workerId of workerIdsToCleanup) {
      const workers = await tenant.adminClient.listWorkers();
      const stillPresent = workers.some((worker) => workerMatches(worker, workerId));
      if (stillPresent) {
        await tenant.adminClient.deleteWorker(workerId);
      }
    }
    await tenant.cleanup();
  }

  return {
    name: 'ap4-mixed-workers',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
