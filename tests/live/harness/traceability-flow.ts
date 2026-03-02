#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Provider = 'openai' | 'google' | 'anthropic';
type CellStatus = 'NOT PASS' | 'PASS' | 'FAIL';

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

type Cell = {
  status: CellStatus;
  runId?: string;
  reportPath?: string;
  summaryPath?: string;
  finishedAt?: string;
  error?: string;
};

type TraceabilityState = {
  generatedAt: string;
  providers: Provider[];
  scenarios: ScenarioDef[];
  cells: Record<string, Record<Provider, Cell>>;
};

type ReportFile = {
  key: string;
  absolutePath: string;
  relativePath: string;
};

const CANONICAL_DEFINITIONS_PATH = path.join(process.cwd(), 'tests/reports/test-cases.v1.json');

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

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'tests/reports/live');
const LEGACY_REPORTS_DIR = path.join(ROOT, 'tests/live/reports');
const STATE_PATH = path.join(ROOT, 'tests/reports/traceability.state.json');
const MARKDOWN_PATH = path.join(ROOT, 'tests/reports/traceability-matrix.md');

function newBaselineState(): TraceabilityState {
  const cells: TraceabilityState['cells'] = {};
  for (const scenario of SCENARIOS) {
    cells[scenario.key] = {
      openai: { status: 'NOT PASS' },
      google: { status: 'NOT PASS' },
      anthropic: { status: 'NOT PASS' },
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    providers: [...PROVIDERS],
    scenarios: [...SCENARIOS],
    cells,
  };
}

function readState(): TraceabilityState {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as TraceabilityState;
  }
  return newBaselineState();
}

function writeState(state: TraceabilityState): void {
  state.generatedAt = new Date().toISOString();
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function renderCell(cell: Cell): string {
  if (cell.status === 'PASS') {
    return `✅ PASS (${cell.runId ?? 'evidence'})`;
  }
  if (cell.status === 'FAIL') {
    return `✗ FAIL (${cell.runId ?? 'evidence'})`;
  }
  return '❌ NOT PASS';
}

function renderEvidenceRows(state: TraceabilityState): string {
  const rows: string[] = [];

  for (const scenario of state.scenarios) {
    for (const provider of state.providers) {
      const cell = state.cells[scenario.key][provider];
      if (cell.status === 'NOT PASS') continue;

      rows.push(
        `| ${scenario.id} | ${provider} | ${cell.status} | ${cell.reportPath ? `\`${cell.reportPath}\`` : '-' } | ${cell.summaryPath ? `\`${cell.summaryPath}\`` : '-' } | ${cell.finishedAt ?? '-'} |`,
      );
    }
  }

  if (!rows.length) {
    return '_No evidence records yet. Run `pnpm test:traceability:run` to populate artifacts._';
  }

  return ['| Scenario | Provider | Status | JSON Evidence | Markdown Summary | Finished At |', '|----------|----------|--------|---------------|------------------|-------------|', ...rows].join('\n');
}

function renderMarkdown(state: TraceabilityState): string {
  const rows = state.scenarios
    .map((scenario) => {
      const openai = renderCell(state.cells[scenario.key].openai);
      const google = renderCell(state.cells[scenario.key].google);
      const anthropic = renderCell(state.cells[scenario.key].anthropic);
      return `| ${scenario.id} | ${scenario.title} | ${scenario.planRef} | ${openai} | ${google} | ${anthropic} | ${scenario.key} |`;
    })
    .join('\n');

  return [
    '# AgentBaton Platform v1.0 — Live Test Traceability Matrix',
    '',
    `**Last Updated:** ${state.generatedAt}`,
    '**Test Plan Reference:** `docs/testing/test-plan-v1.0.md`',
    '**Legend:** ✅ PASS (evidence-backed) | ✗ FAIL (evidence-backed) | ❌ NOT PASS (baseline/unverified)',
    '',
    'Policy:',
    '- Baseline is always reset to **NOT PASS** before any re-execution campaign.',
    '- Cells flip only from parsed `tests/reports/live/run-*.json` evidence generated by scripted runs.',
    '- Human-readable run summaries are emitted alongside JSON evidence at `tests/reports/live/run-*.md`.',
    '- Canonical traceability index is generated to `tests/reports/traceability-matrix.md`.',
    '- No manual/ad-hoc status edits are allowed.',
    '',
    '## Scenario/Provider Matrix',
    '',
    '| ID | Scenario | Plan Ref | OpenAI | Google | Anthropic | Harness Scenario |',
    '|----|----------|----------|--------|--------|-----------|------------------|',
    rows,
    '',
    '## Scripted Flow',
    '',
    '```bash',
    '# 1) reset all cells to NOT PASS',
    'pnpm test:traceability:reset',
    '',
    '# 2) run the full provider×scenario matrix one-by-one and auto-update per real evidence',
    'pnpm test:traceability:run',
    '',
    '# optional: run one cell only',
    'pnpm test:traceability:run -- --provider openai --scenario ot1-cascade',
    '```',
    '',
    '## Evidence Artifacts',
    '',
    renderEvidenceRows(state),
    '',
  ].join('\n');
}

function writeMarkdown(state: TraceabilityState): void {
  writeFileSync(MARKDOWN_PATH, renderMarkdown(state));
}

type RunReport = {
  runId: string;
  provider: string;
  finishedAt?: string;
  scenarios: Record<string, { status: 'pass' | 'fail'; error?: string }>;
};

function listReportFiles(): ReportFile[] {
  const dirs = [REPORTS_DIR, LEGACY_REPORTS_DIR];
  const entries: ReportFile[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((value) => value.startsWith('run-') && value.endsWith('.json')).sort()) {
      const absolutePath = path.join(dir, name);
      const relativePath = path.relative(ROOT, absolutePath).replaceAll('\\\\', '/');
      entries.push({ key: relativePath, absolutePath, relativePath });
    }
  }

  return entries;
}

function parseReportFile(file: ReportFile): RunReport {
  return JSON.parse(readFileSync(file.absolutePath, 'utf8')) as RunReport;
}

function runOne(state: TraceabilityState, provider: Provider, scenario: string): void {
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
        ? path.relative(ROOT, summaryAbsolutePath).replaceAll('\\\\', '/')
        : undefined;
      matched = { report, reportPath: reportFile.relativePath, summaryPath };
      break;
    }
  }

  const cell = state.cells[scenario]?.[provider];
  if (!cell) {
    throw new Error(`Unknown scenario/provider cell: ${scenario}/${provider}`);
  }

  if (!matched) {
    cell.status = 'FAIL';
    cell.error = 'No matching run report found after execution';
    writeState(state);
    writeMarkdown(state);
    throw new Error(`Missing run evidence for ${scenario}/${provider}`);
  }

  const result = matched.report.scenarios[scenario];
  cell.status = result.status === 'pass' && !commandFailed ? 'PASS' : 'FAIL';
  cell.runId = matched.report.runId;
  cell.reportPath = matched.reportPath;
  cell.summaryPath = matched.summaryPath;
  cell.finishedAt = matched.report.finishedAt;
  cell.error = result.error;

  writeState(state);
  writeMarkdown(state);

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
  const state = newBaselineState();
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeState(state);
  writeMarkdown(state);
  console.log('Traceability baseline reset: all scenario/provider cells set to NOT PASS.');
}

function runMatrix(argv: string[]): void {
  const state = readState();

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
    if (!state.scenarios.some((s) => s.key === scenario)) {
      throw new Error(`Unsupported scenario: ${scenario}`);
    }
  }

  for (const provider of providers) {
    for (const scenario of scenarios) {
      console.log(`\n=== Running ${scenario} on ${provider} ===`);
      runOne(state, provider, scenario);
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
  pnpm exec tsx tests/live/harness/traceability-flow.ts run --provider openai --scenario ot1-cascade\n\nReports: tests/reports/live (run-*.json + run-*.md), matrix: tests/reports/traceability-matrix.md`);
}

main();
