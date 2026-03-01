/**
 * Maintenance Happy Path — delegates to AP-5 (autonomous maintenance pipeline).
 *
 * This is the entry point called by the existing runner for the
 * "maintenance-happy" scenario name.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { runAp5SingleBug } from './ap5-maintenance-pipeline.js';

export async function runMaintenanceHappyScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  // Run the first planted bug (pagination) as the default happy path
  return runAp5SingleBug(live, 0);
}
