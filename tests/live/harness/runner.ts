#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resetFixtureRepos } from './repo-factory.js';
import { saveRunReport } from './report.js';
import { setupLiveEnvironment } from './setup.js';
import { teardownLiveEnvironment } from './teardown.js';
import type {
  Provider,
  RunReport,
  RunnerOptions,
  ScenarioExecutionResult,
  ScenarioResult,
  TemplateType,
} from './types.js';
import { runMaintenanceHappyScenario } from '../scenarios/maintenance-happy.js';
import { runMaintenanceSadScenario } from '../scenarios/maintenance-sad.js';
import { runSdlcHappyScenario } from '../scenarios/sdlc-happy.js';
import { runSdlcSadScenario } from '../scenarios/sdlc-sad.js';

const PROVIDERS: Provider[] = ['openai', 'google', 'anthropic'];
const TEMPLATES: TemplateType[] = ['sdlc', 'maintenance'];
type ScenarioName = 'sdlc-happy' | 'sdlc-sad' | 'maintenance-happy' | 'maintenance-sad';

function loadEnvFile(envPath = '/root/.secrets/openai-test.env'): void {
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function printUsage(): void {
  console.log(`Usage: pnpm test:live [options]\n\nOptions:\n  --all                       Run both templates across all providers\n  --template <sdlc|maintenance>\n                              Run a single template (default: sdlc)\n  --provider <openai|google|anthropic>\n                              Run a single provider (default: openai)\n  --happy-only                Run happy-path scenarios only\n  --sad-only                  Run sad-path scenarios only\n  --repeat <N>                Repeat the selected matrix N times (default: 1)\n  --dashboard                 Run Playwright dashboard E2E suite\n  -h, --help                  Show this help message\n`);
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseTemplate(value: string): TemplateType {
  if (value === 'sdlc' || value === 'maintenance') {
    return value;
  }
  throw new Error(`Invalid --template value: ${value}. Expected one of: sdlc, maintenance`);
}

function parseProvider(value: string): Provider {
  if (value === 'openai' || value === 'google' || value === 'anthropic') {
    return value;
  }
  throw new Error(`Invalid --provider value: ${value}. Expected one of: openai, google, anthropic`);
}

function parseArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    all: false,
    happyOnly: false,
    sadOnly: false,
    repeat: 1,
    dashboard: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--template') {
      options.template = parseTemplate(requireArgValue(argv, i, '--template'));
      i += 1;
    } else if (arg === '--provider') {
      options.provider = parseProvider(requireArgValue(argv, i, '--provider'));
      i += 1;
    } else if (arg === '--happy-only') {
      options.happyOnly = true;
    } else if (arg === '--sad-only') {
      options.sadOnly = true;
    } else if (arg === '--repeat') {
      options.repeat = Number(requireArgValue(argv, i, '--repeat'));
      i += 1;
    } else if (arg === '--dashboard') {
      options.dashboard = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.happyOnly && options.sadOnly) {
    throw new Error('Cannot pass both --happy-only and --sad-only');
  }

  if (!Number.isInteger(options.repeat) || options.repeat <= 0) {
    throw new Error(`--repeat must be a positive integer; got ${options.repeat}`);
  }

  if (options.dashboard && (options.template || options.happyOnly || options.sadOnly || options.all)) {
    throw new Error('--dashboard cannot be combined with --template, --all, --happy-only, or --sad-only');
  }

  return options;
}

function scenarioResultFromSuccess(startedAt: number, result: ScenarioExecutionResult): ScenarioResult {
  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  return {
    status: 'pass',
    duration: `${durationSec}s`,
    cost: `$${result.costUsd.toFixed(4)}`,
    artifacts: result.artifacts.length,
    validations: result.validations.length,
    screenshots: result.screenshots,
  };
}

function scenarioResultFromFailure(startedAt: number, error: unknown): ScenarioResult {
  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  return {
    status: 'fail',
    duration: `${durationSec}s`,
    cost: '$0.0000',
    artifacts: 0,
    validations: 0,
    screenshots: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runScenarioByName(
  name: ScenarioName,
  live: Awaited<ReturnType<typeof setupLiveEnvironment>>,
): Promise<ScenarioExecutionResult> {
  if (name === 'sdlc-happy') {
    return runSdlcHappyScenario(live);
  }
  if (name === 'sdlc-sad') {
    return runSdlcSadScenario(live);
  }
  if (name === 'maintenance-happy') {
    return runMaintenanceHappyScenario(live);
  }
  return runMaintenanceSadScenario(live);
}

function scenariosFor(template: TemplateType, options: RunnerOptions): ScenarioName[] {
  if (template === 'dashboard') {
    return [];
  }

  const names: ScenarioName[] = template === 'sdlc' ? ['sdlc-happy', 'sdlc-sad'] : ['maintenance-happy', 'maintenance-sad'];

  if (options.happyOnly) {
    return names.filter((entry) => entry.endsWith('happy')) as ScenarioName[];
  }

  if (options.sadOnly) {
    return names.filter((entry) => entry.endsWith('sad')) as ScenarioName[];
  }

  return names;
}

function makeRunId(template: TemplateType, provider: Provider, repeatIndex: number): string {
  const date = new Date().toISOString().replace(/[.:]/g, '-');
  return `${date}-${template}-${provider}-r${repeatIndex + 1}`;
}

function runDashboardPlaywright(runId: string, startedAt: number): ScenarioResult {
  try {
    execFileSync(
      'pnpm',
      ['exec', 'playwright', 'test', '-c', 'tests/live/playwright.config.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          LIVE_RUN_ID: runId,
        },
      },
    );

    return {
      status: 'pass',
      duration: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      cost: '$0.0000',
      artifacts: 1,
      validations: 1,
      screenshots: [],
    };
  } catch (error) {
    return scenarioResultFromFailure(startedAt, error);
  }
}

async function runCombination(
  template: TemplateType,
  provider: Provider,
  options: RunnerOptions,
  repeatIndex: number,
): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const runId = makeRunId(template, provider, repeatIndex);
  mkdirSync(path.join(process.cwd(), 'tests/live/reports/screenshots'), { recursive: true });

  if (template === 'dashboard') {
    const scenarioStartedAt = Date.now();
    const scenarioResults: Record<string, ScenarioResult> = {
      dashboard: runDashboardPlaywright(runId, scenarioStartedAt),
    };

    return {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      template,
      provider,
      repeat: options.repeat,
      scenarios: scenarioResults,
      containers_leaked: 0,
      temp_files_leaked: 0,
      total_cost: '$0.0000',
    };
  }

  const live = await setupLiveEnvironment({ runId, template, provider });
  resetFixtureRepos();

  const scenarios = scenariosFor(template, options);
  const scenarioResults: Record<string, ScenarioResult> = {};
  let totalCost = 0;

  for (const scenario of scenarios) {
    const scenarioStartedAt = Date.now();
    try {
      const result = await runScenarioByName(scenario, live);
      scenarioResults[scenario] = scenarioResultFromSuccess(scenarioStartedAt, result);
      totalCost += result.costUsd;
    } catch (error) {
      scenarioResults[scenario] = scenarioResultFromFailure(scenarioStartedAt, error);
    }
  }

  const cleanup = teardownLiveEnvironment();
  const finishedAt = new Date().toISOString();

  return {
    runId,
    startedAt,
    finishedAt,
    template,
    provider,
    repeat: options.repeat,
    scenarios: scenarioResults,
    containers_leaked: cleanup.leakedContainers,
    temp_files_leaked: cleanup.leakedTempFiles,
    total_cost: `$${totalCost.toFixed(4)}`,
  };
}

function makeExecutionMatrix(options: RunnerOptions): Array<{ template: TemplateType; provider: Provider }> {
  if (options.dashboard) {
    return [{ template: 'dashboard', provider: options.provider ?? 'openai' }];
  }

  if (options.all) {
    return TEMPLATES.flatMap((template) =>
      PROVIDERS.map((provider) => ({ template, provider })),
    );
  }

  const template = options.template ?? 'sdlc';
  const provider = options.provider ?? 'openai';
  return [{ template, provider }];
}

async function main(): Promise<void> {
  loadEnvFile('/root/.secrets/openai-test.env');

  const options = parseArgs(process.argv.slice(2));
  const matrix = makeExecutionMatrix(options);
  const reports: RunReport[] = [];

  for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex += 1) {
    for (const entry of matrix) {
      const report = await runCombination(entry.template, entry.provider, options, repeatIndex);
      saveRunReport(report);
      reports.push(report);
    }
  }

  const failed = reports.some((report) =>
    Object.values(report.scenarios).some((scenario) => scenario.status === 'fail'),
  );

  if (failed) {
    process.exitCode = 1;
  }
}

void main();
