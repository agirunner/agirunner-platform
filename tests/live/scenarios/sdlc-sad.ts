import path from 'node:path';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { executeLiveValidationSet } from './common.js';

export async function runSdlcSadScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  return executeLiveValidationSet({
    scenarioName: 'sdlc-sad',
    live,
    repoPath: path.join(process.cwd(), 'tests/live/fixtures/calc-api'),
    expectedTerminal: 'failed',
    expectedDashboardText: 'AgentBaton',
    expectedEvents: ['task.created', 'task.state_changed'],
    simulatedCostUsd: 0.05,
  });
}
