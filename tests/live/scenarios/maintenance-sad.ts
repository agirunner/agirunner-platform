import path from 'node:path';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { executeLiveValidationSet } from './common.js';

export async function runMaintenanceSadScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  return executeLiveValidationSet({
    scenarioName: 'maintenance-sad',
    live,
    repoPath: path.join(process.cwd(), 'tests/live/fixtures/todo-app'),
    expectedTerminal: 'cancelled',
    expectedDashboardText: 'AgentBaton',
    expectedEvents: ['task.created', 'task.state_changed'],
    simulatedCostUsd: 0.07,
  });
}
