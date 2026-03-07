/**
 * AP-6: External Worker Maintenance Workflow (todo-app fixture)
 *
 * Harness-managed external runtime scenario for maintenance flow:
 * triage -> fix -> verify -> close
 *
 * Test plan ref: AP-6
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import {
  assertAllTasksCompleted,
  assertDependencyOrder,
  assertInitialWorkflowState,
  assertWorkflowTerminal,
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
import { pollWorkflowUntil } from './poll.js';
import { maintenanceTemplateSchema } from './templates.js';
import { createTenantBootstrap, registerWorkerAgent } from './tenant.js';
import { resolveFixtureRepoPath } from '../harness/repo-factory.js';

const config = loadConfig();

const MAINTENANCE_ROLES = ['architect', 'developer', 'qa', 'reviewer'];
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

export function resolveAp6TodoFixtureRepo(): string {
  return resolveFixtureRepoPath('todo-app');
}

export async function runAp6RuntimeMaintenance(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const tenant = await createTenantBootstrap('ap6-runtime-maintenance');
  const validations: string[] = [];
  let externalWorkerId: string | undefined;

  try {
    const registered = await registerWorkerAgent(tenant, {
      workerName: `ap6-external-worker-${live.runId}`,
      workerCapabilities: EXTERNAL_CAPABILITIES,
      agentName: `ap6-external-agent-${live.runId}`,
      agentCapabilities: EXTERNAL_CAPABILITIES,
      connectionMode: 'polling',
      runtimeType: 'external',
    });

    externalWorkerId = registered.workerId;
    const externalHarness: HarnessWorker = {
      label: 'ap6-external-worker',
      workerId: registered.workerId,
      agentId: registered.agentId,
      capabilities: EXTERNAL_CAPABILITIES,
      agentClient: registered.agentClient,
    };

    validations.push('external_worker_registered');
    validations.push('external_agent_registered');

    const template = await tenant.adminClient.createTemplate({
      name: `AP-6 Maintenance ${live.runId}`,
      slug: `ap6-maint-${live.runId}`,
      schema: maintenanceTemplateSchema(),
    });
    validations.push('template_created');

    const workflow = await tenant.adminClient.createWorkflow({
      template_id: template.id,
      name: `AP-6 todo-app ${live.runId}`,
      parameters: {
        repo: resolveAp6TodoFixtureRepo(),
        issue: 'pagination',
        description: 'Page 2 shows same items as page 1 — off-by-one in pagination slice',
      },
    });
    validations.push('workflow_created');

    assertTaskRoles(workflow, MAINTENANCE_ROLES);
    assertInitialWorkflowState(workflow);
    validations.push('initial_state_valid');

    const handledRoles: string[] = [];

    for (const expectedRole of MAINTENANCE_ROLES) {
      const claimed = await claimTaskWithPolling(externalHarness, workflow.id);

      if (claimed.role !== expectedRole) {
        throw new Error(`Expected ${expectedRole} task, claimed ${claimed.role ?? claimed.type}`);
      }

      if (claimed.assigned_worker_id && claimed.assigned_worker_id !== externalHarness.workerId) {
        throw new Error(
          `Task ${claimed.id} assigned_worker_id ${claimed.assigned_worker_id} did not match external worker ${externalHarness.workerId}`,
        );
      }

      await startAndCompleteTask(externalHarness, claimed, 'ap6-runtime-maintenance');
      handledRoles.push(claimed.role ?? claimed.type);
      validations.push(`task_completed:${expectedRole}`);
    }

    if (handledRoles.join(',') !== MAINTENANCE_ROLES.join(',')) {
      throw new Error(`Unexpected maintenance role handling order: ${handledRoles.join(', ')}`);
    }
    validations.push('routing_all_tasks_external');

    const completed = await pollWorkflowUntil(
      tenant.adminClient,
      workflow.id,
      ['completed', 'failed'],
      config.workflowTimeoutMs,
    );

    assertWorkflowTerminal(completed, 'completed', 4);
    assertAllTasksCompleted(completed);
    assertTaskOutputsPresent(completed);
    assertDependencyOrder(completed);
    validations.push('workflow_completed');
    validations.push('maintenance_output_present');

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
    name: 'ap6-runtime-maintenance',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
  };
}
