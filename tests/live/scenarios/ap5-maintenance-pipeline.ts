/**
 * AP-5: Built-in Worker — Maintenance Pipeline (todo-app)
 *
 * Tests the autonomous maintenance pipeline for bug-fix workflows:
 * triage → fix → verify → close.
 *
 * The system is given a planted bug description and must autonomously
 * diagnose and fix it. The test plan specifies 3 planted bugs:
 * - Pagination off-by-one
 * - Missing validation
 * - Silent delete failure
 *
 * After pipeline creation, the harness only polls/observes.
 *
 * Test plan ref: Section 2, AP-5
 * FR refs: FR-074, FR-075, FR-076–FR-078, FR-191–FR-193, FR-745, FR-748
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
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
import { maintenanceTemplateSchema } from './templates.js';

const config = loadConfig();

interface PlantedBug {
  issue: string;
  description: string;
  expectedPath: string;
  expectedPatternHints: string[];
}

const PLANTED_BUGS: PlantedBug[] = [
  {
    issue: 'pagination',
    description: 'Page 2 shows same items as page 1 — off-by-one in pagination slice',
    expectedPath: 'src/app.js',
    expectedPatternHints: ['pagination', 'off-by-one', 'slice'],
  },
  {
    issue: 'validation',
    description: 'Missing input validation allows empty TODO items to be created',
    expectedPath: 'src/app.js',
    expectedPatternHints: ['validation', 'empty', 'title'],
  },
  {
    issue: 'delete-failure',
    description: 'Delete endpoint returns 200 but silently fails to remove the item',
    expectedPath: 'src/app.js',
    expectedPatternHints: ['delete', 'silently', 'remove'],
  },
];

function assertOutputMentionsFileAndPattern(
  pipeline: { tasks?: Array<{ output?: unknown }> },
  bug: PlantedBug,
): void {
  const serializedOutputs = (pipeline.tasks ?? [])
    .map((task) => JSON.stringify(task.output ?? {}))
    .join('\n')
    .toLowerCase();

  if (!serializedOutputs.includes(bug.expectedPath.toLowerCase())) {
    throw new Error(
      `Maintenance output for issue "${bug.issue}" did not mention expected file path "${bug.expectedPath}"`,
    );
  }

  const hasPatternMention = bug.expectedPatternHints.some((hint) => serializedOutputs.includes(hint.toLowerCase()));
  if (!hasPatternMention) {
    throw new Error(
      `Maintenance output for issue "${bug.issue}" did not mention expected bug pattern hints (${bug.expectedPatternHints.join(', ')})`,
    );
  }
}

/**
 * Runs the AP-5 scenario for a single planted bug.
 *
 * 1. Creates maintenance template with triage → fix → verify → close chain
 * 2. Creates pipeline targeting the specific planted bug
 * 3. Polls until pipeline completes autonomously
 * 4. Asserts all tasks completed with outputs
 */
async function runSingleBug(
  live: LiveContext,
  bug: PlantedBug,
): Promise<{ validations: string[] }> {
  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const validations: string[] = [];

  // Create template
  const template = await client.createTemplate({
    name: `AP-5 Maintenance ${bug.issue} ${live.runId}`,
    slug: `ap5-maint-${bug.issue}-${live.runId}`,
    schema: maintenanceTemplateSchema(),
  });
  validations.push(`template_created:${bug.issue}`);

  // Create pipeline
  const pipeline = await client.createPipeline({
    template_id: template.id,
    name: `AP-5 todo-app ${bug.issue} ${live.runId}`,
    parameters: {
      repo: 'todo-app',
      issue: bug.issue,
      description: bug.description,
    },
  });
  validations.push(`pipeline_created:${bug.issue}`);

  // Verify initial state
  assertTaskRoles(pipeline, ['architect', 'developer', 'qa', 'reviewer']);
  assertInitialPipelineState(pipeline);
  validations.push(`initial_state:${bug.issue}`);

  // AUTONOMOUS EXECUTION — only poll
  const completed = await pollPipelineUntil(
    client,
    pipeline.id,
    ['completed', 'failed'],
    config.pipelineTimeoutMs,
  );

  // Assert success
  assertPipelineTerminal(completed, 'completed', 4);
  assertAllTasksCompleted(completed);
  assertTaskOutputsPresent(completed);
  assertDependencyOrder(completed);
  assertOutputMentionsFileAndPattern(completed, bug);
  validations.push(`pipeline_completed:${bug.issue}`);
  validations.push(`output_mentions_file_and_pattern:${bug.issue}`);

  return { validations };
}

/**
 * Runs AP-5 for all 3 planted bugs sequentially.
 */
export async function runAp5MaintenancePipeline(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const allValidations: string[] = [];

  for (const bug of PLANTED_BUGS) {
    const result = await runSingleBug(live, bug);
    allValidations.push(...result.validations);
  }

  return {
    name: 'ap5-maintenance-pipeline',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
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
  };
}
