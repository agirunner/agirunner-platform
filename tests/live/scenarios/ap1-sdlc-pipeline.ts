/**
 * AP-1: Built-in Worker — SDLC Pipeline (calc-api)
 *
 * Tests the full autonomous SDLC pipeline using the built-in worker:
 * architect → developer → reviewer → qa.
 *
 * After creating the template and pipeline via API, the harness only
 * polls and observes. The built-in worker must autonomously claim and
 * execute all 4 tasks, with the orchestrator cascading dependencies.
 *
 * Assertions verify structure and schema, not exact LLM output.
 *
 * Test plan ref: Section 2, AP-1
 * FR refs: FR-002, FR-013, FR-014, FR-060–FR-067, FR-070–FR-078,
 *          FR-743, FR-745, FR-747, FR-748
 */

import type {
  LiveContext,
  ScenarioDeliveryEvidence,
  ScenarioExecutionResult,
} from '../harness/types.js';
import type { ApiPipeline } from '../api-client.js';
import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import {
  assertAllTasksCompleted,
  assertDependencyOrder,
  assertInitialPipelineState,
  assertPipelineTerminal,
  assertTaskOutputsPresent,
  assertTaskRoles,
} from './assertions.js';
import { pollPipelineUntil } from './poll.js';
import { sdlcTemplateSchema } from './templates.js';

const config = loadConfig();

/**
 * Runs the AP-1 scenario: full SDLC pipeline on calc-api via built-in worker.
 *
 * 1. Creates SDLC template with 4-task dependency chain
 * 2. Creates pipeline with calc-api repo and "add multiply" goal
 * 3. Verifies initial state (first task ready, rest pending)
 * 4. Polls until pipeline completes or times out
 * 5. Asserts all tasks completed with outputs present
 */
export async function runAp1SdlcPipeline(live: LiveContext): Promise<ScenarioExecutionResult> {
  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const validations: string[] = [];

  // Step 1: Create SDLC template
  const template = await client.createTemplate({
    name: `AP-1 SDLC ${live.runId}`,
    slug: `ap1-sdlc-${live.runId}`,
    schema: sdlcTemplateSchema(),
  });
  validations.push('template_created');

  // Step 2: Create pipeline
  const pipeline = await client.createPipeline({
    template_id: template.id,
    name: `AP-1 calc-api ${live.runId}`,
    parameters: {
      repo: 'calc-api',
      goal: 'Add a multiply endpoint to the calculator API',
    },
  });
  validations.push('pipeline_created');

  // Step 3: Verify initial state
  assertTaskRoles(pipeline, ['architect', 'developer', 'reviewer', 'qa']);
  validations.push('task_roles_correct');

  assertInitialPipelineState(pipeline);
  validations.push('initial_state_correct');

  // Step 4: AUTONOMOUS EXECUTION — only poll, no API calls to move tasks
  const completed = await pollPipelineUntil(
    client,
    pipeline.id,
    ['completed', 'failed'],
    config.pipelineTimeoutMs,
  );

  // Step 5: Assert completed successfully
  assertPipelineTerminal(completed, 'completed', 4);
  validations.push('pipeline_completed');

  assertAllTasksCompleted(completed);
  validations.push('all_tasks_completed');

  assertTaskOutputsPresent(completed);
  validations.push('task_outputs_present');

  assertDependencyOrder(completed);
  validations.push('dependency_order_respected');

  const authenticityEvidence: ScenarioDeliveryEvidence[] = [
    {
      pipelineId: completed.id,
      pipelineState: completed.state,
      acceptanceCriteria: [
        'Pipeline reaches completed terminal state with exactly 4 tasks',
        'All tasks complete with non-empty structured outputs',
        'Task dependency order is respected end-to-end',
        'Delivery includes concrete implementation evidence for requested goal',
      ],
      requiresGitDiffEvidence: true,
      tasks: (completed.tasks ?? []).map((task) => ({
        id: task.id,
        role: task.role ?? task.type,
        state: task.state,
        output: task.output ?? null,
      })),
    },
  ];

  return {
    name: 'ap1-sdlc-pipeline',
    costUsd: 0,
    artifacts: [],
    validations,
    screenshots: [],
    authenticityEvidence,
  };
}
