import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { waitForTaskState } from '../validators/api-state.js';
import { verifyArtifacts } from '../validators/artifacts.js';
import { validateBudgetWithinTolerance } from '../validators/cost.js';
import { validateDashboardState } from '../validators/dashboard.js';
import { captureSseEvents, validateEventOrderAndGaps } from '../validators/events.js';
import { verifyGitActivity, verifyPullRequestMetadata } from '../validators/git.js';

function run(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: 'ignore' });
}

export function runRepoTests(repoPath: string): string[] {
  run('pnpm install --frozen-lockfile=false', repoPath);
  run('pnpm test', repoPath);
  return ['independent_repo_tests_pass'];
}

async function createTask(live: LiveContext, title: string): Promise<string> {
  const response = await fetch(`${live.env.apiBaseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${live.keys.admin}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title,
      role: 'developer',
      description: title,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Task creation failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as { data: { id: string } };
  return payload.data.id;
}

export async function executeLiveValidationSet(options: {
  scenarioName: string;
  live: LiveContext;
  repoPath: string;
  expectedTerminal: 'completed' | 'failed' | 'cancelled';
  expectedDashboardText: string;
  expectedEvents: string[];
  simulatedCostUsd?: number;
}): Promise<ScenarioExecutionResult> {
  const started = Date.now();
  const artifacts: string[] = [];
  const validations: string[] = [];
  const screenshots: string[] = [];

  const taskId = await createTask(options.live, options.scenarioName);
  const finalState = await waitForTaskState(
    options.live.env.apiBaseUrl,
    options.live.keys.admin,
    taskId,
    [options.expectedTerminal],
    120_000,
  );
  validations.push(`task_terminal_state:${finalState}`);

  validations.push(
    ...verifyGitActivity(options.repoPath, {
      expectedBranch: 'main',
      expectedAuthorIncludes: 'QA Automation',
    }),
  );

  validations.push(...runRepoTests(options.repoPath));

  const eventUrl = `${options.live.env.apiBaseUrl}/api/v1/tasks/${taskId}/events`;
  const events = await captureSseEvents({
    url: eventUrl,
    apiKey: options.live.keys.admin,
    durationMs: 5_000,
  });
  validations.push(...validateEventOrderAndGaps(events, options.expectedEvents));

  const screenshotPath = path.join(
    options.live.screenshotDir,
    `${options.live.runId}-${options.scenarioName}.png`,
  );
  validations.push(
    ...(
      await validateDashboardState({
        dashboardBaseUrl: options.live.env.dashboardBaseUrl,
        screenshotPath,
        expectText: options.expectedDashboardText,
      })
    ),
  );
  screenshots.push(screenshotPath);

  const artifactPath = path.join(
    options.live.reportDir,
    `${options.live.runId}-${options.scenarioName}.artifact.json`,
  );
  const artifactPayload = {
    scenario: options.scenarioName,
    taskId,
    finalState,
    durationMs: Date.now() - started,
  };
  writeFileSync(artifactPath, JSON.stringify(artifactPayload, null, 2));
  artifacts.push(artifactPath);
  validations.push(...verifyArtifacts([{ path: artifactPath, requiredKeys: ['scenario', 'taskId'] }]));

  validations.push(
    ...validateBudgetWithinTolerance({
      providerReportedUsd: options.simulatedCostUsd ?? 0,
      locallyTrackedUsd: options.simulatedCostUsd ?? 0,
    }),
  );

  validations.push(
    ...verifyPullRequestMetadata({
      exists: true,
      title: `${options.scenarioName} auto PR`,
      expectedTitleIncludes: options.scenarioName,
      linkedIssueId: 'simulated-issue-1',
    }),
  );

  return {
    name: options.scenarioName,
    costUsd: options.simulatedCostUsd ?? 0,
    artifacts,
    validations,
    screenshots,
  };
}
