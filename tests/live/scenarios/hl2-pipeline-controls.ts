import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTenantBootstrap, registerWorkerAgent } from './tenant.js';
import { linearTemplateSchema } from './templates.js';

function parseStatusCodeFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/ returned (\d+):/);
  return match ? Number(match[1]) : null;
}

async function expectHttpStatus(
  label: string,
  expectedStatus: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected ${label} to fail with HTTP ${expectedStatus}, but request succeeded`);
  } catch (error) {
    const status = parseStatusCodeFromError(error);
    if (status !== expectedStatus) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Expected ${label} to fail with HTTP ${expectedStatus}, got ${status ?? 'unknown'} (${message})`,
      );
    }
  }
}

export async function runHl2PipelineControls(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('hl2-controls');
  const validations: string[] = [];

  try {
    const pair = await registerWorkerAgent(tenant, {
      workerName: `hl2-worker-${live.runId}`,
      workerCapabilities: ['llm-api', 'role:architect', 'role:developer', 'role:reviewer'],
      agentName: `hl2-agent-${live.runId}`,
      agentCapabilities: ['llm-api', 'role:architect', 'role:developer', 'role:reviewer'],
      connectionMode: 'polling',
      runtimeType: 'external',
    });

    const template = await tenant.adminClient.createTemplate({
      name: `HL-2 controls ${live.runId}`,
      slug: `hl2-controls-${live.runId}`,
      schema: linearTemplateSchema(),
    });

    const pipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `HL-2 pipeline controls ${live.runId}`,
    });

    const firstTask = await pair.agentClient.claimTask({
      agent_id: pair.agentId,
      worker_id: pair.workerId,
      capabilities: ['llm-api', 'role:architect'],
      pipeline_id: pipeline.id,
    });
    if (!firstTask) throw new Error('HL-2 expected first task to be claimable');

    await pair.agentClient.startTask(firstTask.id, { agent_id: pair.agentId });
    validations.push('task_started');

    await tenant.adminClient.cancelTask(firstTask.id);
    const cancelledTask = await pair.agentClient.getTask(firstTask.id);
    if (cancelledTask.state !== 'cancelled') {
      throw new Error(`HL-2 expected task cancel state, got ${cancelledTask.state}`);
    }
    validations.push('task_cancelled');

    const pipeline2 = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `HL-2 full cancel ${live.runId}`,
    });

    await tenant.adminClient.cancelPipeline(pipeline2.id);
    const cancelledPipeline = await tenant.adminClient.getPipeline(pipeline2.id);
    const cancellableStates = new Set(['cancelled', 'completed', 'failed']);
    if (!cancellableStates.has(cancelledPipeline.state)) {
      throw new Error(`HL-2 expected cancelled/terminal pipeline, got ${cancelledPipeline.state}`);
    }
    validations.push('pipeline_cancelled');

    await expectHttpStatus('invalid transition complete from ready', 409, () =>
      pair.agentClient.completeTask(firstTask.id, {
        summary: 'attempt complete from cancelled',
      }),
    );
    validations.push('invalid_transition_409');

    const retried = await tenant.adminClient.retryTask(firstTask.id);
    if (retried.state !== 'ready') {
      throw new Error(`HL-2 expected retry to move task to ready, got ${retried.state}`);
    }
    validations.push('retry_from_cancelled');
  } finally {
    await tenant.cleanup();
  }

  return {
    name: 'hl2-pipeline-controls',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
