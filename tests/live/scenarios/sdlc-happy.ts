/**
 * SDLC Happy Path — delegates to AP-1 (autonomous SDLC workflow).
 *
 * This is the entry point called by the existing runner for the "sdlc-happy"
 * scenario name. It runs the full AP-1 test scenario.
 */

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { runAp1SdlcWorkflow } from './ap1-sdlc-workflow.js';

export async function runSdlcHappyScenario(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  return runAp1SdlcWorkflow(live);
}
