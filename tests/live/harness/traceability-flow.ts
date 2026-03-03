#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { regenerateLaneResults } from './report.js';

type Provider = 'openai' | 'google' | 'anthropic';
type CellStatus = 'NOT_PASS' | 'PASS' | 'FAIL';

type ScenarioDef = {
  key: string;
  id: string;
  title: string;
  planRef: string;
};

type CanonicalTestCases = {
  version: string;
  providers: Provider[];
  scenarios: ScenarioDef[];
};

type LiveCell = {
  status: CellStatus;
  runId?: string;
  artifactJsonPath?: string;
  artifactMdPath?: string;
  finishedAt?: string;
  error?: string;
  attempts?: number;
  retryCount?: number;
  retryReasons?: string[];
};

type ConsolidatedResults = {
  version: '1.0';
  generatedAt?: string;
  providers: Provider[];
  scenarios: ScenarioDef[];
  live_cells: Record<string, Record<Provider, LiveCell>>;
};

type ReportFile = {
  key: string;
  absolutePath: string;
  relativePath: string;
};

type RunReport = {
  runId: string;
  provider: Provider;
  finishedAt?: string;
  scenarios: Record<string, { status: 'pass' | 'fail'; error?: string }>;
};

type RunMode = 'cold' | 'warm';

type CellExecution = {
  report: RunReport;
  reportPath: string;
  summaryPath?: string;
  commandFailed: boolean;
  durationMs: number;
  attempts: number;
  retryReasons: string[];
};

const ROOT = process.cwd();
const CANONICAL_DEFINITIONS_PATH = path.join(ROOT, 'tests/reports/test-cases.v1.json');
const CONSOLIDATED_RESULTS_PATH = path.join(ROOT, 'tests/reports/results.v1.json');
const LIVE_ARTIFACTS_DIR = path.join(ROOT, 'tests/artifacts/live');

const INFRA_FAILURE_SIGNATURES = [
  /timed out waiting for/i,
  /econnrefused/i,
  /fetch failed/i,
  /docker compose/i,
  /live harness preflight failed/i,
  /network error/i,
  /socket hang up/i,
  /service unavailable/i,
];

function isInfraFailureSignature(message: string): boolean {
  return INFRA_FAILURE_SIGNATURES.some((pattern) => pattern.test(message));
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function summarizeDurations(samples: number[]): { medianMs: number; avgMs: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const avgMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1);
  return { medianMs, avgMs };
}

function loadCanonicalDefinitions(): CanonicalTestCases {
  if (!existsSync(CANONICAL_DEFINITIONS_PATH)) {
    throw new Error(`Missing canonical test-case definitions: ${CANONICAL_DEFINITIONS_PATH}`);
  }

  const parsed = JSON.parse(readFileSync(CANONICAL_DEFINITIONS_PATH, 'utf8')) as CanonicalTestCases;

  if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
    throw new Error('Canonical definitions must declare at least one provider');
  }

  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error('Canonical definitions must declare at least one scenario');
  }

  return parsed;
}

const CANONICAL_DEFINITIONS = loadCanonicalDefinitions();
const PROVIDERS: Provider[] = [...CANONICAL_DEFINITIONS.providers];
const SCENARIOS: ScenarioDef[] = [...CANONICAL_DEFINITIONS.scenarios];

function baselineLiveCells(): ConsolidatedResults['live_cells'] {
  const cells = {} as ConsolidatedResults['live_cells'];
  for (const scenario of SCENARIOS) {
    cells[scenario.key] = {
      openai: { status: 'NOT_PASS' },
      google: { status: 'NOT_PASS' },
      anthropic: { status: 'NOT_PASS' },
    };
  }
  return cells;
}

function readResults(): ConsolidatedResults {
  if (existsSync(CONSOLIDATED_RESULTS_PATH)) {
    const parsed = JSON.parse(readFileSync(CONSOLIDATED_RESULTS_PATH, 'utf8')) as ConsolidatedResults;
    return {
      version: '1.0',
      providers: Array.isArray(parsed.providers) ? parsed.providers : [...PROVIDERS],
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [...SCENARIOS],
      live_cells: parsed.live_cells ?? baselineLiveCells(),
      generatedAt: parsed.generatedAt,
    };
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    providers: [...PROVIDERS],
    scenarios: [...SCENARIOS],
    live_cells: baselineLiveCells(),
  };
}

function writeResults(results: ConsolidatedResults): void {
  results.generatedAt = new Date().toISOString();
  mkdirSync(path.dirname(CONSOLIDATED_RESULTS_PATH), { recursive: true });
  writeFileSync(CONSOLIDATED_RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');
  regenerateLaneResults(ROOT);
}

function listReportFiles(): ReportFile[] {
  const entries: ReportFile[] = [];

  if (!existsSync(LIVE_ARTIFACTS_DIR)) return entries;

  for (const name of readdirSync(LIVE_ARTIFACTS_DIR).filter((value) => value.startsWith('run-') && value.endsWith('.json')).sort()) {
    const absolutePath = path.join(LIVE_ARTIFACTS_DIR, name);
    const relativePath = path.relative(ROOT, absolutePath).replaceAll('\\', '/');
    entries.push({ key: relativePath, absolutePath, relativePath });
  }

  return entries;
}

function parseReportFile(file: ReportFile): RunReport {
  return JSON.parse(readFileSync(file.absolutePath, 'utf8')) as RunReport;
}

function runStrictPreflight(provider: Provider, keepStack: boolean): void {
  const args = [
    'exec',
    'tsx',
    'tests/live/harness/runner.ts',
    '--lane',
    'live',
    '--provider',
    provider,
    '--preflight-only',
  ];

  if (keepStack) {
    args.push('--keep-stack');
  }

  execFileSync('pnpm', args, { stdio: 'inherit' });
}

function shutdownComposeStack(): void {
  try {
    execSync('docker compose down -v --remove-orphans', { cwd: ROOT, stdio: 'inherit' });
    return;
  } catch {
    // fall through
  }

  try {
    execSync('docker-compose down -v --remove-orphans', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    // best-effort cleanup only
  }
}

function executeScenarioOnce(provider: Provider, scenario: string, mode: RunMode): Omit<CellExecution, 'attempts'> {
  const startedAt = Date.now();
  const before = new Set(listReportFiles().map((entry) => entry.key));

  const args = [
    'exec',
    'tsx',
    'tests/live/harness/runner.ts',
    '--lane',
    'live',
    '--provider',
    provider,
    '--scenario',
    scenario,
  ];

  if (mode === 'warm') {
    args.push('--keep-stack', '--fast-reset');
  }

  let commandFailed = false;
  let commandErrorText = '';
  try {
    execFileSync('pnpm', args, {
      stdio: 'inherit',
      env:
        mode === 'warm'
          ? {
              ...process.env,
              LIVE_SKIP_STACK_SETUP: '1',
            }
          : process.env,
    });
  } catch (error) {
    commandFailed = true;
    commandErrorText = error instanceof Error ? error.message : String(error);
  }

  const after = listReportFiles();
  const newReports = after.filter((entry) => !before.has(entry.key));

  let matched: { report: RunReport; reportPath: string; summaryPath?: string } | undefined;
  for (const reportFile of [...newReports].reverse()) {
    const report = parseReportFile(reportFile);
    if (report.provider === provider && report.scenarios[scenario]) {
      const summaryAbsolutePath = reportFile.absolutePath.replace(/\.json$/u, '.md');
      const summaryPath = existsSync(summaryAbsolutePath)
        ? path.relative(ROOT, summaryAbsolutePath).replaceAll('\\', '/')
        : undefined;
      matched = { report, reportPath: reportFile.relativePath, summaryPath };
      break;
    }
  }

  if (!matched) {
    throw new Error(
      `Missing run evidence for ${scenario}/${provider}: ${commandErrorText || 'No matching run report found after execution'}`,
    );
  }

  if (commandFailed && !matched.report.scenarios[scenario]?.error) {
    matched.report.scenarios[scenario] = {
      status: 'fail',
      error: commandErrorText || 'Scenario command failed with no report error detail',
    };
  }

  return {
    report: matched.report,
    reportPath: matched.reportPath,
    summaryPath: matched.summaryPath,
    commandFailed,
    durationMs: Date.now() - startedAt,
  };
}

function runOne(results: ConsolidatedResults, provider: Provider, scenario: string, mode: RunMode): CellExecution {
  const maxAttempts = 2;

  let attempt = 0;
  let lastError: Error | undefined;
  const retryReasons: string[] = [];

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const execution = executeScenarioOnce(provider, scenario, mode);
      const result = execution.report.scenarios[scenario];
      const cell = results.live_cells[scenario]?.[provider];
      if (!cell) {
        throw new Error(`Unknown scenario/provider cell: ${scenario}/${provider}`);
      }

      cell.status = result.status === 'pass' && !execution.commandFailed ? 'PASS' : 'FAIL';
      cell.runId = execution.report.runId;
      cell.artifactJsonPath = execution.reportPath;
      cell.artifactMdPath = execution.summaryPath;
      cell.finishedAt = execution.report.finishedAt;
      cell.error = result.error;
      cell.attempts = attempt;
      cell.retryCount = Math.max(0, attempt - 1);
      cell.retryReasons = [...retryReasons];

      writeResults(results);

      if (execution.commandFailed) {
        throw new Error(result.error ?? `Scenario execution failed for ${scenario}/${provider}`);
      }

      return { ...execution, attempts: attempt, retryReasons: [...retryReasons] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(message);

      const canRetry = attempt < maxAttempts && isInfraFailureSignature(message);
      if (canRetry) {
        retryReasons.push(message);
        console.log(`  ↻ Infra signature detected; retrying once (${scenario}/${provider})...`);
        continue;
      }

      const cell = results.live_cells[scenario]?.[provider];
      if (cell) {
        cell.status = 'FAIL';
        cell.error = message;
        cell.attempts = attempt;
        cell.retryCount = Math.max(0, attempt - 1);
        cell.retryReasons = [...retryReasons];
        writeResults(results);
      }

      break;
    }
  }

  throw lastError ?? new Error(`Scenario execution failed for ${scenario}/${provider}`);
}

function parseCsvArg(argv: string[], flag: string): string[] | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resetBaseline(): void {
  const results = readResults();
  results.providers = [...PROVIDERS];
  results.scenarios = [...SCENARIOS];
  results.live_cells = baselineLiveCells();
  mkdirSync(path.dirname(CONSOLIDATED_RESULTS_PATH), { recursive: true });
  writeResults(results);
  console.log('Live lane baseline reset: all scenario/provider cells set to NOT_PASS.');
}

function runMatrix(argv: string[], mode: RunMode): void {
  const results = readResults();

  const providerArg = parseCsvArg(argv, '--providers');
  const scenarioArg = parseCsvArg(argv, '--scenarios');
  const oneProvider = parseCsvArg(argv, '--provider');
  const oneScenario = parseCsvArg(argv, '--scenario');

  const providers = (oneProvider ?? providerArg ?? PROVIDERS) as Provider[];
  const scenarios = oneScenario ?? scenarioArg ?? SCENARIOS.map((s) => s.key);

  for (const provider of providers) {
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  for (const scenario of scenarios) {
    if (!results.scenarios.some((s) => s.key === scenario)) {
      throw new Error(`Unsupported scenario: ${scenario}`);
    }
  }

  const durations: number[] = [];

  if (mode === 'warm') {
    for (const provider of providers) {
      runStrictPreflight(provider, true);
    }
  }

  try {
    for (const provider of providers) {
      for (const scenario of scenarios) {
        console.log(`\n=== Running ${scenario} on ${provider} (${mode}) ===`);
        const execution = runOne(results, provider, scenario, mode);
        durations.push(execution.durationMs);

        const finalStatus = execution.report.scenarios[scenario]?.status ?? 'fail';
        const attemptsLabel = execution.attempts > 1 ? ` | attempts=${execution.attempts}` : '';
        console.log(
          `  ⏱ duration=${formatSeconds(execution.durationMs)} | status=${finalStatus.toUpperCase()}${attemptsLabel}`,
        );
      }
    }
  } finally {
    if (mode === 'warm') {
      shutdownComposeStack();
    }
  }

  if (durations.length > 0) {
    const { medianMs, avgMs } = summarizeDurations(durations);
    console.log(
      `\nTiming summary (${mode}): runs=${durations.length} | median=${formatSeconds(medianMs)} | avg=${formatSeconds(avgMs)}`,
    );
  }
}

function preflight(argv: string[]): void {
  const oneProvider = parseCsvArg(argv, '--provider');
  const providerArg = parseCsvArg(argv, '--providers');
  const providers = (oneProvider ?? providerArg ?? ['openai']) as Provider[];

  for (const provider of providers) {
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  for (const provider of providers) {
    console.log(`\n=== Strict preflight (${provider}) ===`);
    runStrictPreflight(provider, false);
  }
}

function main(): void {
  const [command = 'help', ...rest] = process.argv.slice(2);

  if (command === 'reset') {
    resetBaseline();
    return;
  }

  if (command === 'run') {
    runMatrix(rest, 'cold');
    return;
  }

  if (command === 'run-fast') {
    runMatrix(rest, 'warm');
    return;
  }

  if (command === 'preflight') {
    preflight(rest);
    return;
  }

  console.log(`Usage:
  pnpm exec tsx tests/live/harness/traceability-flow.ts reset
  pnpm exec tsx tests/live/harness/traceability-flow.ts preflight [--provider openai]
  pnpm exec tsx tests/live/harness/traceability-flow.ts run [--providers openai,google,anthropic] [--scenarios ot1-cascade,it1-sdk]
  pnpm exec tsx tests/live/harness/traceability-flow.ts run-fast [--providers openai,google,anthropic] [--scenarios ot1-cascade,it1-sdk]
  pnpm exec tsx tests/live/harness/traceability-flow.ts run --provider openai --scenario ot1-cascade
  pnpm exec tsx tests/live/harness/traceability-flow.ts run-fast --provider openai --scenario ot1-cascade\n\nArtifacts: tests/artifacts/live (run-*.json + run-*.md)\nConsolidated results: tests/reports/results.v1.json`);
}

main();
