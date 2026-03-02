import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { loadConfig } from '../config.js';
import { pollPipelineUntil } from './poll.js';
import { createTenantBootstrap, registerWorkerAgent } from './tenant.js';

const config = loadConfig();

function approvalTemplateSchema(): Record<string, unknown> {
  return {
    tasks: [
      {
        id: 'developer',
        title_template: 'Developer task',
        type: 'code',
        role: 'developer',
        capabilities_required: ['llm-api', 'role:developer'],
      },
      {
        id: 'review',
        title_template: 'Review approval task',
        type: 'review',
        role: 'reviewer',
        depends_on: ['developer'],
        requires_approval: true,
        capabilities_required: ['llm-api', 'role:reviewer'],
      },
    ],
  };
}

export async function runHl1ApprovalFlow(live: LiveContext): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('hl1-approval');
  const validations: string[] = [];

  try {
    const registered = await registerWorkerAgent(tenant, {
      workerName: `hl1-worker-${live.runId}`,
      workerCapabilities: ['llm-api', 'role:developer', 'role:reviewer'],
      agentName: `hl1-agent-${live.runId}`,
      agentCapabilities: ['llm-api', 'role:developer', 'role:reviewer'],
      connectionMode: 'polling',
      runtimeType: 'external',
    });

    const template = await tenant.adminClient.createTemplate({
      name: `HL-1 approval ${live.runId}`,
      slug: `hl1-approval-${live.runId}`,
      schema: approvalTemplateSchema(),
    });
    validations.push('approval_template_created');

    const pipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `HL-1 approve path ${live.runId}`,
    });
    validations.push('approval_pipeline_created');

    const first = await registered.agentClient.claimTask({
      agent_id: registered.agentId,
      worker_id: registered.workerId,
      capabilities: ['llm-api', 'role:developer'],
      pipeline_id: pipeline.id,
    });
    if (!first) throw new Error('Expected developer task to be claimable for HL-1');

    await registered.agentClient.startTask(first.id, { agent_id: registered.agentId });
    await registered.agentClient.completeTask(first.id, {
      summary: 'Developer step complete for approval flow',
      role: 'developer',
    });
    validations.push('developer_task_completed');

    const paused = await pollPipelineUntil(
      tenant.adminClient,
      pipeline.id,
      ['paused', 'running', 'failed', 'completed'],
      config.pipelineTimeoutMs,
    );
    const approvalTask = (paused.tasks ?? []).find((task) => task.role === 'reviewer');
    if (!approvalTask) {
      throw new Error('HL-1 expected reviewer approval task to exist');
    }
    if (approvalTask.state !== 'awaiting_approval') {
      throw new Error(
        `HL-1 expected reviewer task in awaiting_approval, got ${approvalTask.state}`,
      );
    }
    validations.push('awaiting_approval_visible');

    await tenant.adminClient.approveTask(approvalTask.id);
    validations.push('approval_action_applied');

    const review = await registered.agentClient.claimTask({
      agent_id: registered.agentId,
      worker_id: registered.workerId,
      capabilities: ['llm-api', 'role:reviewer'],
      pipeline_id: pipeline.id,
    });
    if (!review) throw new Error('HL-1 expected reviewer task to become claimable after approval');

    await registered.agentClient.startTask(review.id, { agent_id: registered.agentId });
    await registered.agentClient.completeTask(review.id, {
      summary: 'Reviewer approved and completed task',
      role: 'reviewer',
    });

    const completed = await pollPipelineUntil(
      tenant.adminClient,
      pipeline.id,
      ['completed', 'failed'],
      config.pipelineTimeoutMs,
    );
    if (completed.state !== 'completed') {
      throw new Error(`HL-1 expected completed pipeline after approve path, got ${completed.state}`);
    }
    validations.push('approval_pipeline_completed');

    const rejectPipeline = await tenant.adminClient.createPipeline({
      template_id: template.id,
      name: `HL-1 retry path ${live.runId}`,
    });

    const rejectFirst = await registered.agentClient.claimTask({
      agent_id: registered.agentId,
      worker_id: registered.workerId,
      capabilities: ['llm-api', 'role:developer'],
      pipeline_id: rejectPipeline.id,
    });
    if (!rejectFirst) throw new Error('Expected developer task in retry path');

    await registered.agentClient.startTask(rejectFirst.id, { agent_id: registered.agentId });
    await registered.agentClient.completeTask(rejectFirst.id, {
      summary: 'Developer step for retry path',
      role: 'developer',
    });

    const rejectPaused = await pollPipelineUntil(
      tenant.adminClient,
      rejectPipeline.id,
      ['paused', 'running', 'failed', 'completed'],
      config.pipelineTimeoutMs,
    );
    const rejectTask = (rejectPaused.tasks ?? []).find((task) => task.role === 'reviewer');
    if (!rejectTask) throw new Error('HL-1 retry path missing reviewer task');

    await tenant.adminClient.cancelTask(rejectTask.id);
    validations.push('approval_reject_simulated_via_cancel');

    const retried = await tenant.adminClient.retryTask(rejectTask.id);
    if (retried.state !== 'ready') {
      throw new Error(`HL-1 expected retry to set task ready, got ${retried.state}`);
    }
    validations.push('retry_from_rejected_path');
  } finally {
    await tenant.cleanup();
  }

  return {
    name: 'hl1-approval-flow',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
