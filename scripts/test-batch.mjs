#!/usr/bin/env node

import path from 'node:path';

import {
  DEFAULTS_PATH,
  ROOT,
  assertProviderEnv,
  filterProvidersWithEnv,
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
  options.requestedProviders = [...options.providers];
  options.skippedProviders = [];

  if (options.providersExplicit) {
    assertProviderEnv(options.providers, options.dryRun);
  } else {
    const { selected, missing } = filterProvidersWithEnv(options.providers, options.dryRun);
    options.providers = selected;
    options.skippedProviders = missing;

    if (!options.dryRun && missing.length > 0) {
      console.warn(
        `[test-batch] warning: missing provider credentials for ${missing
          .map(({ provider, keys }) => `${provider}(${keys.join('|')})`)
          .join(', ')}; skipping corresponding live stages.`,
      );
    }
  }

  const runId = nowIso().replace(/[.:]/g, '-');
  const reportDir = path.resolve(ROOT, options.reportDir || `${defaults.reportRoot}/run-${runId}`);
  const stages = await buildStages(defaults, options, runId, reportDir);

  const summary = await runBatch(options, defaults, runId, reportDir, stages);
  console.log(`[test-batch] reportDir=${summary.reportDir}`);
  console.log(`[test-batch] summaryJson=${summary.artifacts.summaryJsonPath}`);
  console.log(`[test-batch] summaryMd=${summary.artifacts.summaryMarkdownPath}`);
  console.log(`[test-batch] finalExitCode=${summary.finalExitCode}`);
  process.exitCode = summary.finalExitCode;
}

main().catch((error) => {
  console.error(`[test-batch] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
