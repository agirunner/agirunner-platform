/**
 * AP-5: Built-in Worker — Maintenance Workflow (todo-app)
 *
 * Tests the autonomous maintenance workflow for bug-fix workflows:
 * triage → fix → verify → close.
 *
 * The system is given a planted bug description and must autonomously
 * diagnose and fix it. The test plan specifies 3 planted bugs:
 * - Pagination off-by-one
 * - Missing validation
 * - Silent delete failure
 *
 * After workflow creation, the harness only polls/observes.
 *
 * Test plan ref: Section 2, AP-5
 * FR refs: FR-074, FR-075, FR-076–FR-078, FR-191–FR-193, FR-745, FR-748
 */

import type {
  LiveContext,
  ScenarioDeliveryEvidence,
  ScenarioExecutionResult,
} from '../harness/types.js';
import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import {
  assertAllTasksCompleted,
  assertDependencyOrder,
  assertInitialWorkflowState,
  assertWorkflowTerminal,
  assertTaskOutputsPresent,
  assertTaskRoles,
} from './assertions.js';
import { pollWorkflowUntil } from './poll.js';
import { maintenanceTemplateSchema } from './templates.js';

const config = loadConfig();

interface PlantedBug {
  issue: string;
  description: string;
}

const PLANTED_BUGS: PlantedBug[] = [
  {
    issue: 'pagination',
    description: 'Page 2 shows same items as page 1 — off-by-one in pagination slice',
  },
  {
    issue: 'validation',
    description: 'Missing input validation allows empty TODO items to be created',
  },
  {
    issue: 'delete-failure',
    description: 'Delete endpoint returns 200 but silently fails to remove the item',
  },
];

/**
 * Runs the AP-5 scenario for a single planted bug.
 *
 * 1. Creates maintenance template with triage → fix → verify → close chain
 * 2. Creates workflow targeting the specific planted bug
 * 3. Polls until workflow completes autonomously
 * 4. Asserts all tasks completed with outputs
 */
async function runSingleBug(
  live: LiveContext,
  bug: PlantedBug,
): Promise<{ validations: string[]; evidence: ScenarioDeliveryEvidence }> {
  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const validations: string[] = [];

  // Create template
  const template = await client.createTemplate({
    name: `AP-5 Maintenance ${bug.issue} ${live.runId}`,
    slug: `ap5-maint-${bug.issue}-${live.runId}`,
    schema: maintenanceTemplateSchema(),
  });
  validations.push(`template_created:${bug.issue}`);

  // Create workflow
  const workflow = await client.createWorkflow({
    template_id: template.id,
    name: `AP-5 todo-app ${bug.issue} ${live.runId}`,
    parameters: {
      repo: 'todo-app',
      issue: bug.issue,
      description: bug.description,
    },
  });
  validations.push(`workflow_created:${bug.issue}`);

  // Verify initial state
  assertTaskRoles(workflow, ['architect', 'developer', 'qa', 'reviewer']);
  assertInitialWorkflowState(workflow);
  validations.push(`initial_state:${bug.issue}`);

  // AUTONOMOUS EXECUTION — only poll
  const completed = await pollWorkflowUntil(
    client,
    workflow.id,
    ['completed', 'failed'],
    config.workflowTimeoutMs,
  );

  // Assert success
  assertWorkflowTerminal(completed, 'completed', 4);
  assertAllTasksCompleted(completed);
  assertTaskOutputsPresent(completed);
  assertDependencyOrder(completed);

  // Validate that outputs exist, without requiring specific path mentions.
  validations.push(`output_present:${bug.issue}`);
  validations.push(`workflow_completed:${bug.issue}`);

  return {
    validations,
    evidence: {
      workflowId: completed.id,
      workflowState: completed.state,
      acceptanceCriteria: [
        `Maintenance workflow resolves planted bug: ${bug.issue}`,
        'Triage/fix/verify/close chain completes with concrete outputs',
        'Delivery includes concrete file-level or diff-level change evidence',
      ],
      requiresGitDiffEvidence: true,
      tasks: (completed.tasks ?? []).map((task) => ({
        id: task.id,
        role: task.role ?? task.type,
        state: task.state,
        output: task.output ?? null,
      })),
    },
  };
}

/**
 * Runs AP-5 for all 3 planted bugs sequentially.
 */
export async function runAp5MaintenanceWorkflow(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const allValidations: string[] = [];
  const authenticityEvidence: ScenarioDeliveryEvidence[] = [];

  for (const bug of PLANTED_BUGS) {
    const result = await runSingleBug(live, bug);
    allValidations.push(...result.validations);
    authenticityEvidence.push(result.evidence);
  }

  return {
    name: 'ap5-maintenance-workflow',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
    authenticityEvidence,
  };
}

/**
 * Runs AP-5 for a single bug (useful for targeted testing).
 */
export async function runAp5SingleBug(
  live: LiveContext,
  bugIndex = 0,
): Promise<ScenarioExecutionResult> {
  const bug = PLANTED_BUGS[bugIndex];
  if (!bug) throw new Error(`Invalid bug index ${bugIndex}. Valid: 0-${PLANTED_BUGS.length - 1}`);

  const result = await runSingleBug(live, bug);
  return {
    name: `ap5-maintenance-${bug.issue}`,
    costUsd: 0,
    artifacts: [],
    validations: result.validations,
    screenshots: [],
    authenticityEvidence: [result.evidence],
  };
}
