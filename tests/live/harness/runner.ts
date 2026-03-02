#!/usr/bin/env node
/**
 * Live Test Harness Runner
 *
 * Entry point for test lanes:
 *  - core: deterministic control-plane checks (no live provider calls)
 *  - live: batch live-environment scenario checks (LLM use allowed via SUT agent/orchestrator flows)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupFixtureWorkspace, prepareFixtureWorkspace } from './repo-factory.js';
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
  TestLane,
} from './types.js';

// Scenario imports
import { runSdlcHappyScenario } from '../scenarios/sdlc-happy.js';
import { runSdlcSadScenario } from '../scenarios/sdlc-sad.js';
import { runMaintenanceHappyScenario } from '../scenarios/maintenance-happy.js';
import { runMaintenanceSadScenario } from '../scenarios/maintenance-sad.js';
import { runAp2ExternalRuntime } from '../scenarios/ap2-external-runtime.js';
import { runAp3StandaloneWorker } from '../scenarios/ap3-standalone-worker.js';
import { runAp4MixedWorkers } from '../scenarios/ap4-mixed-workers.js';
import { runAp5MaintenancePipeline } from '../scenarios/ap5-maintenance-pipeline.js';
import { runAp6RuntimeMaintenance } from '../scenarios/ap6-runtime-maintenance.js';
import { runAp7FailureRecovery } from '../scenarios/ap7-failure-recovery.js';
import { runOt1DependencyCascade } from '../scenarios/ot1-dependency-cascade.js';
import { runOt2TaskRouting } from '../scenarios/ot2-task-routing.js';
import { runOt3PipelineState } from '../scenarios/ot3-pipeline-state.js';
import { runOt4WorkerHealth } from '../scenarios/ot4-worker-health.js';
import { runHl1ApprovalFlow } from '../scenarios/hl1-approval-flow.js';
import { runHl2PipelineControls } from '../scenarios/hl2-pipeline-controls.js';
import { runIt1Sdk } from '../scenarios/it1-sdk.js';
import { runIt2Mcp } from '../scenarios/it2-mcp.js';
import { runIt3Webhooks } from '../scenarios/it3-webhooks.js';
import { runIt3McpSseStream } from '../scenarios/it3-mcp-sse-stream.js';
import { runSi1TenantIsolation } from '../scenarios/si1-tenant-isolation.js';
import { runSi2Auth } from '../scenarios/si2-auth.js';
import { runSi2ExtendedIsolation } from '../scenarios/si2-extended-isolation.js';
import { LiveApiClient, type ApiWorker } from '../api-client.js';

const LIVE_PROVIDERS: Provider[] = ['openai', 'google', 'anthropic'];
const TEMPLATES: TemplateType[] = ['sdlc', 'maintenance'];

type ScenarioName =
  | 'sdlc-happy'
  | 'sdlc-sad'
  | 'maintenance-happy'
  | 'maintenance-sad'
  | 'ap2-external-runtime'
  | 'ap3-standalone-worker'
  | 'ap4-mixed-workers'
  | 'ap5-full'
  | 'ap6-runtime-maintenance'
  | 'ap7-failure-recovery'
  | 'ot1-cascade'
  | 'ot2-routing'
  | 'ot3-state'
  | 'ot4-health'
  | 'hl1-approval-flow'
  | 'hl2-pipeline-controls'
  | 'it1-sdk'
  | 'it2-mcp'
  | 'it3-webhooks'
  | 'it3-mcp-sse-stream'
  | 'si1-isolation'
  | 'si2-auth'
  | 'si2-extended-isolation';

const ALL_SCENARIOS: ScenarioName[] = [
  'sdlc-happy',
  'ap2-external-runtime',
  'ap3-standalone-worker',
  'ap4-mixed-workers',
  'sdlc-sad',
  'maintenance-happy',
  'maintenance-sad',
  'ap5-full',
  'ap6-runtime-maintenance',
  'ap7-failure-recovery',
  'ot1-cascade',
  'ot2-routing',
  'ot3-state',
  'ot4-health',
  'hl1-approval-flow',
  'hl2-pipeline-controls',
  'it1-sdk',
  'it2-mcp',
  'it3-webhooks',
  'it3-mcp-sse-stream',
  'si1-isolation',
  'si2-auth',
  'si2-extended-isolation',
];

const CORE_SCENARIOS: ScenarioName[] = [
  'ap2-external-runtime',
  'ap3-standalone-worker',
  'ap4-mixed-workers',
  'ap6-runtime-maintenance',
  'ot1-cascade',
  'ot2-routing',
  'ot3-state',
  'ot4-health',
  'hl1-approval-flow',
  'hl2-pipeline-controls',
  'it1-sdk',
  'it2-mcp',
  'it3-webhooks',
  'it3-mcp-sse-stream',
  'si1-isolation',
  'si2-auth',
  'si2-extended-isolation',
];

const CORE_DEFAULT_SCENARIOS: ScenarioName[] = [
  'ap2-external-runtime',
  'ap3-standalone-worker',
  'ap4-mixed-workers',
  'ot1-cascade',
  'ot4-health',
  'hl1-approval-flow',
  'it1-sdk',
  'si1-isolation',
];

const LIVE_DEFAULT_SCENARIOS: ScenarioName[] = [
  'sdlc-happy',
  'maintenance-happy',
  'ap5-full',
  'ap7-failure-recovery',
];

const AP_SCENARIOS_REQUIRING_AUTONOMOUS_WORKER = new Set<ScenarioName>([
  'sdlc-happy',
  'ap5-full',
  'ap7-failure-recovery',
]);

const WORKER_PREFLIGHT_TIMEOUT_MS = Number(process.env.LIVE_WORKER_PREFLIGHT_TIMEOUT_MS ?? 45_000);
const WORKER_PREFLIGHT_INTERVAL_MS = Number(process.env.LIVE_WORKER_PREFLIGHT_INTERVAL_MS ?? 1_500);

function loadEnvFile(envPath = '/root/.secrets/openai-test.env'): void {
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function printUsage(): void {
  console.log(
    `Usage: pnpm test:live [options]\n\nOptions:\n  --lane <core|live>           Select deterministic core lane or batch live scenario lane\n                               (default: core)\n  --all                        Run full lane matrix\n  --template <sdlc|maintenance>\n                               Run a single template (live lane only)\n  --scenario <name>            Run a specific scenario by name\n  --provider <openai|google|anthropic>\n                               Live lane provider selection (default: openai)\n  --happy-only                 Run happy-path scenarios only (template mode only)\n  --sad-only                   Run sad-path scenarios only (template mode only)\n  --repeat <N>                 Repeat selected matrix N times (default: 1)\n  --dashboard                  Run Playwright dashboard E2E suite\n  -h, --help                   Show this help message\n\nCore default scenarios: ${CORE_DEFAULT_SCENARIOS.join(', ')}\nCore full scenarios (--all): ${CORE_SCENARIOS.join(', ')}\nLive default scenarios: ${LIVE_DEFAULT_SCENARIOS.join(', ')}\nAll scenarios: ${ALL_SCENARIOS.join(', ')}\n\nArtifacts: tests/artifacts/{core,integration,live}/run-*.{json,md}\nLane summaries: tests/reports/{core-results.json,integration-results.json,live-results.json}\n`,
  );
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseTemplate(value: string): TemplateType {
  if (value === 'sdlc' || value === 'maintenance') return value;
  throw new Error(`Invalid --template value: ${value}. Expected: sdlc, maintenance`);
}

function parseProvider(value: string): Provider {
  if (value === 'openai' || value === 'google' || value === 'anthropic') return value;
  throw new Error(`Invalid --provider value: ${value}. Expected: openai, google, anthropic`);
}

function parseLane(value: string): TestLane {
  if (value === 'core' || value === 'live') return value;
  throw new Error(`Invalid --lane value: ${value}. Expected: core, live`);
}

interface ExtendedOptions extends RunnerOptions {
  scenario?: string;
}

export function parseArgs(argv: string[]): ExtendedOptions {
  const options: ExtendedOptions = {
    all: false,
    lane: 'core',
    happyOnly: false,
    sadOnly: false,
    repeat: 1,
    dashboard: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--all') options.all = true;
    else if (arg === '--lane') {
      options.lane = parseLane(requireArgValue(argv, i, '--lane'));
      i += 1;
    } else if (arg === '--template') {
      options.template = parseTemplate(requireArgValue(argv, i, '--template'));
      i += 1;
    } else if (arg === '--scenario') {
      options.scenario = requireArgValue(argv, i, '--scenario');
      i += 1;
    } else if (arg === '--provider') {
      options.provider = parseProvider(requireArgValue(argv, i, '--provider'));
      i += 1;
    } else if (arg === '--happy-only') options.happyOnly = true;
    else if (arg === '--sad-only') options.sadOnly = true;
    else if (arg === '--repeat') {
      options.repeat = Number(requireArgValue(argv, i, '--repeat'));
      i += 1;
    } else if (arg === '--dashboard') options.dashboard = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.happyOnly && options.sadOnly)
    throw new Error('Cannot pass both --happy-only and --sad-only');
  if (!Number.isInteger(options.repeat) || options.repeat <= 0)
    throw new Error(`--repeat must be a positive integer; got ${options.repeat}`);

  if (options.lane === 'core' && options.provider) {
    throw new Error('--provider is not allowed in --lane core (core is deterministic and LLM-free)');
  }

  if (options.lane === 'core' && options.template) {
    throw new Error('--template is not supported in --lane core; use --scenario or --all');
  }

  return options;
}

function scenarioResultFromSuccess(
  startedAt: number,
  result: ScenarioExecutionResult,
): ScenarioResult {
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
  switch (name) {
    case 'sdlc-happy':
      return runSdlcHappyScenario(live);
    case 'ap2-external-runtime':
      return runAp2ExternalRuntime(live);
    case 'ap3-standalone-worker':
      return runAp3StandaloneWorker(live);
    case 'ap4-mixed-workers':
      return runAp4MixedWorkers(live);
    case 'sdlc-sad':
      return runSdlcSadScenario(live);
    case 'maintenance-happy':
      return runMaintenanceHappyScenario(live);
    case 'maintenance-sad':
      return runMaintenanceSadScenario(live);
    case 'ap5-full':
      return runAp5MaintenancePipeline(live);
    case 'ap6-runtime-maintenance':
      return runAp6RuntimeMaintenance(live);
    case 'ap7-failure-recovery':
      return runAp7FailureRecovery(live);
    case 'ot1-cascade':
      return runOt1DependencyCascade(live);
    case 'ot2-routing':
      return runOt2TaskRouting(live);
    case 'ot3-state':
      return runOt3PipelineState(live);
    case 'ot4-health':
      return runOt4WorkerHealth(live);
    case 'hl1-approval-flow':
      return runHl1ApprovalFlow(live);
    case 'hl2-pipeline-controls':
      return runHl2PipelineControls(live);
    case 'it1-sdk':
      return runIt1Sdk(live);
    case 'it2-mcp':
      return runIt2Mcp(live);
    case 'it3-webhooks':
      return runIt3Webhooks(live);
    case 'it3-mcp-sse-stream':
      return runIt3McpSseStream(live);
    case 'si1-isolation':
      return runSi1TenantIsolation(live);
    case 'si2-auth':
      return runSi2Auth(live);
    case 'si2-extended-isolation':
      return runSi2ExtendedIsolation(live);
    default:
      throw new Error(`Unknown scenario: ${name}`);
  }
}

export function resolveScenarios(options: ExtendedOptions): ScenarioName[] {
  if (options.scenario) {
    const scenarioAliases: Record<string, ScenarioName> = {
      'si1-tenant-isolation': 'si1-isolation',
    };
    const normalizedScenario = scenarioAliases[options.scenario] ?? options.scenario;

    const found = ALL_SCENARIOS.find(
      (s) => s === normalizedScenario || s.startsWith(normalizedScenario),
    );
    if (!found)
      throw new Error(`Unknown scenario: ${options.scenario}. Valid: ${ALL_SCENARIOS.join(', ')}`);

    if (options.lane === 'core' && !CORE_SCENARIOS.includes(found)) {
      throw new Error(
        `Scenario ${found} is not allowed in core lane. Core lane scenarios: ${CORE_SCENARIOS.join(', ')}`,
      );
    }
    return [found];
  }

  if (options.dashboard) return [];

  if (options.lane === 'core') {
    return options.all ? [...CORE_SCENARIOS] : [...CORE_DEFAULT_SCENARIOS];
  }

  if (options.all) return [...ALL_SCENARIOS];

  // Live template-based selection
  const template = options.template ?? 'sdlc';
  let names: ScenarioName[] =
    template === 'sdlc' ? ['sdlc-happy', 'sdlc-sad'] : ['maintenance-happy', 'maintenance-sad'];

  if (options.happyOnly) names = names.filter((n) => n.endsWith('happy'));
  if (options.sadOnly) names = names.filter((n) => n.endsWith('sad'));

  if (!options.template && !options.happyOnly && !options.sadOnly) {
    return [...LIVE_DEFAULT_SCENARIOS];
  }

  return names;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeWorkers(workers: ApiWorker[]): string {
  if (workers.length === 0) {
    return 'none';
  }

  return workers
    .map((worker) => {
      const workerId = String(worker.id ?? worker.worker_id ?? 'unknown-id');
      const name = String(worker.name ?? 'unnamed');
      const status = String(worker.status ?? 'unknown');
      const mode = String(worker.connection_mode ?? 'unknown');
      const runtime = String(worker.runtime_type ?? 'unknown');
      return `${name}(${workerId}):${status}/${mode}/${runtime}`;
    })
    .join(', ');
}

async function assertAutonomousWorkerReady(
  live: Awaited<ReturnType<typeof setupLiveEnvironment>>,
  scenarios: ScenarioName[],
): Promise<void> {
  const requiredScenarios = scenarios.filter((name) =>
    AP_SCENARIOS_REQUIRING_AUTONOMOUS_WORKER.has(name),
  );
  if (requiredScenarios.length === 0) {
    return;
  }

  const client = new LiveApiClient(live.env.apiBaseUrl, live.keys.admin);
  const startedAt = Date.now();
  let lastWorkers: ApiWorker[] = [];

  while (Date.now() - startedAt < WORKER_PREFLIGHT_TIMEOUT_MS) {
    lastWorkers = await client.listWorkers();

    const hasOnlineWebsocketWorker = lastWorkers.some(
      (worker) =>
        (worker.status === 'online' || worker.status === 'busy') &&
        worker.connection_mode === 'websocket',
    );

    if (hasOnlineWebsocketWorker) {
      return;
    }

    await sleep(WORKER_PREFLIGHT_INTERVAL_MS);
  }

  throw new Error(
    `Live harness preflight failed: AP scenarios (${requiredScenarios.join(', ')}) require at least one online websocket worker, but none were found. ` +
      `Observed workers: ${summarizeWorkers(lastWorkers)}. ` +
      'Ensure docker-compose service "worker" is running and DEFAULT_ADMIN_API_KEY is shared between platform-api and worker.',
  );
}

function makeRunId(template: TemplateType, provider: Provider, repeatIndex: number): string {
  const date = new Date().toISOString().replace(/[.:]/g, '-');
  return `${date}-${template}-${provider}-r${repeatIndex + 1}`;
}

function runDashboardPlaywright(runId: string, startedAt: number): ScenarioResult {
  try {
    execFileSync('pnpm', ['exec', 'playwright', 'test', '-c', 'tests/live/playwright.config.ts'], {
      stdio: 'inherit',
      env: { ...process.env, LIVE_RUN_ID: runId },
    });
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

export function assertLiveApiKey(provider: Provider): void {
  const requiredEnvByProvider: Record<'openai' | 'google' | 'anthropic', string[]> = {
    openai: ['OPENAI_API_KEY'],
    google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
  };

  if (provider === 'none') {
    throw new Error('Live lane requires a provider, not provider "none"');
  }

  const acceptedKeys = requiredEnvByProvider[provider];
  const hasKey = acceptedKeys.some((key) => {
    const value = process.env[key]?.trim();
    return Boolean(value);
  });

  if (!hasKey) {
    throw new Error(
      `Live lane requires provider API keys. Missing key for provider ${provider}. Expected one of: ${acceptedKeys.join(', ')}`,
    );
  }
}

async function runCombination(
  template: TemplateType,
  provider: Provider,
  options: ExtendedOptions,
  repeatIndex: number,
): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const runId = makeRunId(template, provider, repeatIndex);
  mkdirSync(path.join(process.cwd(), 'tests/artifacts/live/screenshots'), { recursive: true });

  if (template === 'dashboard') {
    const scenarioStartedAt = Date.now();
    return {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      template,
      provider,
      repeat: options.repeat,
      scenarios: { dashboard: runDashboardPlaywright(runId, scenarioStartedAt) },
      containers_leaked: 0,
      temp_files_leaked: 0,
      total_cost: '$0.0000',
    };
  }

  const live = await setupLiveEnvironment({ runId, template, provider });
  prepareFixtureWorkspace(runId);

  const scenarios = resolveScenarios(options);
  const scenarioResults: Record<string, ScenarioResult> = {};
  let totalCost = 0;
  let cleanup: ReturnType<typeof teardownLiveEnvironment> = {
    leakedContainers: 0,
    leakedTempFiles: 0,
  };

  try {
    await assertAutonomousWorkerReady(live, scenarios);

    for (const scenario of scenarios) {
      console.log(`\n▶ Running scenario: ${scenario}`);
      const scenarioStartedAt = Date.now();
      try {
        const result = await runScenarioByName(scenario, live);
        scenarioResults[scenario] = scenarioResultFromSuccess(scenarioStartedAt, result);
        totalCost += result.costUsd;
        console.log(`  ✓ ${scenario} — ${result.validations.length} validations`);
      } catch (error) {
        scenarioResults[scenario] = scenarioResultFromFailure(scenarioStartedAt, error);
        console.error(
          `  ✗ ${scenario} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    cleanupFixtureWorkspace(runId);
    cleanup = teardownLiveEnvironment();
  }

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    template,
    provider,
    repeat: options.repeat,
    scenarios: scenarioResults,
    containers_leaked: cleanup.leakedContainers,
    temp_files_leaked: cleanup.leakedTempFiles,
    total_cost: `$${totalCost.toFixed(4)}`,
  };
}

export function makeExecutionMatrix(
  options: ExtendedOptions,
): Array<{ template: TemplateType; provider: Provider }> {
  if (options.dashboard)
    return [
      {
        template: 'dashboard' as TemplateType,
        provider: options.lane === 'live' ? (options.provider ?? 'openai') : 'none',
      },
    ];

  if (options.lane === 'core') {
    return [{ template: 'sdlc', provider: 'none' }];
  }

  if (options.all) {
    return TEMPLATES.flatMap((template) => LIVE_PROVIDERS.map((provider) => ({ template, provider })));
  }

  return [{ template: options.template ?? 'sdlc', provider: options.provider ?? 'openai' }];
}

export function assertLiveApiKeysForMatrix(
  matrix: Array<{ template: TemplateType; provider: Provider }>,
): void {
  const providersToValidate = new Set<Provider>();

  for (const entry of matrix) {
    if (entry.provider !== 'none') {
      providersToValidate.add(entry.provider);
    }
  }

  for (const provider of providersToValidate) {
    assertLiveApiKey(provider);
  }
}

export function isDirectExecution(metaUrl = import.meta.url): boolean {
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return fileURLToPath(metaUrl) === scriptPath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.lane === 'live') {
    loadEnvFile('/root/.secrets/openai-test.env');
  }

  const matrix = makeExecutionMatrix(options);

  if (options.lane === 'live') {
    assertLiveApiKeysForMatrix(matrix);
  }

  const reports: RunReport[] = [];

  for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex += 1) {
    for (const entry of matrix) {
      const report = await runCombination(entry.template, entry.provider, options, repeatIndex);
      saveRunReport(report);
      reports.push(report);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('LIVE TEST SUMMARY');
  console.log('='.repeat(60));
  for (const report of reports) {
    console.log(`\nRun: ${report.runId}`);
    for (const [name, result] of Object.entries(report.scenarios)) {
      const icon = result.status === 'pass' ? '✓' : '✗';
      console.log(`  ${icon} ${name} — ${result.duration} — ${result.validations} validations`);
      if (result.error) console.log(`    Error: ${result.error}`);
    }
    if (report.containers_leaked > 0)
      console.log(`  ⚠ Leaked containers: ${report.containers_leaked}`);
    if (report.temp_files_leaked > 0)
      console.log(`  ⚠ Leaked temp files: ${report.temp_files_leaked}`);
  }

  const failed = reports.some((r) => Object.values(r.scenarios).some((s) => s.status === 'fail'));
  if (failed) process.exitCode = 1;
}

if (isDirectExecution()) {
  void main();
}
