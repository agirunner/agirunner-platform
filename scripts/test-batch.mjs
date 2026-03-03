#!/usr/bin/env node

import path from 'node:path';

import {
  DEFAULTS_PATH,
  ROOT,
  assertProviderEnv,
  loadBatchEnv,
  loadJson,
  nowIso,
  parseArgs,
} from './test-batch-lib.mjs';
import { buildStages, runBatch } from './test-batch-runner.mjs';

async function main() {
  const defaults = loadJson(DEFAULTS_PATH);
  loadBatchEnv();

  const options = parseArgs(process.argv.slice(2), defaults);
  assertProviderEnv(options.providers, options.dryRun);

  const runId = nowIso().replace(/[.:]/g, '-');
  const reportDir = path.resolve(ROOT, options.reportDir || `${defaults.reportRoot}/run-${runId}`);
  const stages = buildStages(defaults, options, runId, reportDir);

  const summary = await runBatch(options, defaults, runId, reportDir, stages);
  console.log(`[test-batch] reportDir=${summary.reportDir}`);
  console.log(`[test-batch] finalExitCode=${summary.finalExitCode}`);
  process.exitCode = summary.finalExitCode;
}

main().catch((error) => {
  console.error(`[test-batch] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
