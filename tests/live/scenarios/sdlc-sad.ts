/**
 * SDLC Sad Path — delegates to AP-7 (failure and recovery).
 *
 * This is the entry point called by the existing runner for the "sdlc-sad"
 * scenario name. It runs the AP-7 failure/recovery test.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { runAp7FailureRecovery } from './ap7-failure-recovery.js';

export async function runSdlcSadScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  return runAp7FailureRecovery(live);
}
