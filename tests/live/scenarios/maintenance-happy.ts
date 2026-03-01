import path from 'node:path';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { executeLiveValidationSet } from './common.js';

export async function runMaintenanceHappyScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  return executeLiveValidationSet({
    scenarioName: 'maintenance-happy',
    live,
    repoPath: path.join(process.cwd(), 'tests/live/fixtures/todo-app'),
    expectedTerminal: 'completed',
    expectedDashboardText: 'AgentBaton',
    expectedEvents: ['task.created', 'task.state_changed'],
    simulatedCostUsd: 0.31,
  });
}
