#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

type LiveResults = {
  version: '1.0';
  generatedAt: string;
  lane: 'live';
  providers: Provider[];
  scenarios: ScenarioDef[];
  cells: Record<string, Record<Provider, {
    status: CellStatus;
    runId?: string;
    artifactJsonPath?: string;
    artifactMdPath?: string;
    finishedAt?: string;
    error?: string;
  }>>;
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

const ROOT = process.cwd();
const CANONICAL_DEFINITIONS_PATH = path.join(ROOT, 'tests/reports/test-cases.v1.json');
const LIVE_RESULTS_PATH = path.join(ROOT, 'tests/reports/live-results.json');
const LIVE_ARTIFACTS_DIR = path.join(ROOT, 'tests/artifacts/live');

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

function newBaselineResults(): LiveResults {
  const cells: LiveResults['cells'] = {};
  for (const scenario of SCENARIOS) {
    cells[scenario.key] = {
      openai: { status: 'NOT_PASS' },
      google: { status: 'NOT_PASS' },
      anthropic: { status: 'NOT_PASS' },
    };
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    lane: 'live',
    providers: [...PROVIDERS],
    scenarios: [...SCENARIOS],
    cells,
  };
}

function readResults(): LiveResults {
  if (existsSync(LIVE_RESULTS_PATH)) {
    return JSON.parse(readFileSync(LIVE_RESULTS_PATH, 'utf8')) as LiveResults;
  }
  return newBaselineResults();
}

function writeResults(results: LiveResults): void {
  results.generatedAt = new Date().toISOString();
  mkdirSync(path.dirname(LIVE_RESULTS_PATH), { recursive: true });
  writeFileSync(LIVE_RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');
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

function runOne(results: LiveResults, provider: Provider, scenario: string): void {
  const before = new Set(listReportFiles().map((entry) => entry.key));

  let commandFailed = false;
  try {
    execFileSync(
      'pnpm',
      ['exec', 'tsx', 'tests/live/harness/runner.ts', '--lane', 'live', '--provider', provider, '--scenario', scenario],
      { stdio: 'inherit' },
    );
  } catch {
    commandFailed = true;
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

  const cell = results.cells[scenario]?.[provider];
  if (!cell) {
    throw new Error(`Unknown scenario/provider cell: ${scenario}/${provider}`);
  }

  if (!matched) {
    cell.status = 'FAIL';
    cell.error = 'No matching run report found after execution';
    writeResults(results);
    throw new Error(`Missing run evidence for ${scenario}/${provider}`);
  }

  const result = matched.report.scenarios[scenario];
  cell.status = result.status === 'pass' && !commandFailed ? 'PASS' : 'FAIL';
  cell.runId = matched.report.runId;
  cell.artifactJsonPath = matched.reportPath;
  cell.artifactMdPath = matched.summaryPath;
  cell.finishedAt = matched.report.finishedAt;
  cell.error = result.error;

  writeResults(results);

  if (commandFailed) {
    throw new Error(`Scenario execution failed for ${scenario}/${provider}`);
  }
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
  const results = newBaselineResults();
  mkdirSync(path.dirname(LIVE_RESULTS_PATH), { recursive: true });
  writeResults(results);
  console.log('Live lane baseline reset: all scenario/provider cells set to NOT_PASS.');
}

function runMatrix(argv: string[]): void {
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

  for (const provider of providers) {
    for (const scenario of scenarios) {
      console.log(`\n=== Running ${scenario} on ${provider} ===`);
      runOne(results, provider, scenario);
    }
  }
}

function main(): void {
  const [command = 'help', ...rest] = process.argv.slice(2);

  if (command === 'reset') {
    resetBaseline();
    return;
  }

  if (command === 'run') {
    runMatrix(rest);
    return;
  }

  console.log(`Usage:
  pnpm exec tsx tests/live/harness/traceability-flow.ts reset
  pnpm exec tsx tests/live/harness/traceability-flow.ts run [--providers openai,google,anthropic] [--scenarios ot1-cascade,it1-sdk]
  pnpm exec tsx tests/live/harness/traceability-flow.ts run --provider openai --scenario ot1-cascade\n\nArtifacts: tests/artifacts/live (run-*.json + run-*.md)\nLane summary: tests/reports/live-results.json`);
}

main();
