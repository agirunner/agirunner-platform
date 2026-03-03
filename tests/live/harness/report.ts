import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunReport } from './types.js';

type LaneStatus = 'PASS' | 'FAIL' | 'NOT_PASS';
type Lane = 'core' | 'integration' | 'live';

type ScenarioDef = { key: string; id: string; title: string; planRef: string };

type LaneCell = {
  category: string;
  provider: string;
  mode: string;
  gating: boolean;
  status: LaneStatus;
  evidence_links: string[];
  notes: string[];
  generated_at_utc: string;
};

type LaneRow = {
  use_case_id: string;
  title: string;
  plan_section: string;
  runtime_scope: string;
  cells: LaneCell[];
};

type CoreIntegrationRunRecord = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: LaneStatus;
  artifactJsonPath: string;
  artifactMdPath: string;
  scenarios: Record<string, LaneStatus>;
};

type CoreResults = {
  version: '1.0';
  generatedAt: string;
  generated_at_utc: string;
  lane: 'core';
  status_enum: LaneStatus[];
  summary: Record<LaneStatus, number> & { row_count: number };
  matrix: LaneRow[];
  runs: CoreIntegrationRunRecord[];
};

type IntegrationResults = {
  version: '1.0';
  generatedAt: string;
  generated_at_utc: string;
  lane: 'integration';
  status_enum: LaneStatus[];
  summary: Record<LaneStatus, number> & { row_count: number };
  matrix: LaneRow[];
  runs: CoreIntegrationRunRecord[];
};

type LiveCell = {
  status: LaneStatus;
  runId?: string;
  artifactJsonPath?: string;
  artifactMdPath?: string;
  finishedAt?: string;
  error?: string;
};

type LiveResults = {
  version: '1.0';
  generatedAt: string;
  generated_at_utc: string;
  lane: 'live';
  status_enum: LaneStatus[];
  summary: Record<LaneStatus, number> & { row_count: number };
  matrix: LaneRow[];
  providers: string[];
  scenarios: ScenarioDef[];
  cells: Record<string, Record<string, LiveCell>>;
};

type Canonical = { providers: string[]; scenarios: ScenarioDef[] };

const STATUS_ENUM: LaneStatus[] = ['PASS', 'FAIL', 'NOT_PASS'];

function resolveLane(report: RunReport): Lane {
  if (report.template === 'dashboard') return 'integration';
  if (report.provider === 'none') return 'core';
  return 'live';
}

function nowIso(): string {
  return new Date().toISOString();
}

function renderHumanReport(report: RunReport): string {
  const rows = Object.entries(report.scenarios)
    .map(([name, result]) => {
      return `- ${name}: ${result.status.toUpperCase()} | duration=${result.duration} | cost=${result.cost} | validations=${result.validations} | artifacts=${result.artifacts}`;
    })
    .join('\n');

  return [
    `# Live E2E Report — ${report.runId}`,
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Template: ${report.template}`,
    `Provider: ${report.provider}`,
    `Repeat: ${report.repeat}`,
    `Containers leaked: ${report.containers_leaked}`,
    `Temp files leaked: ${report.temp_files_leaked}`,
    `Total cost: ${report.total_cost}`,
    '',
    '## Scenarios',
    rows,
    '',
  ].join('\n');
}

function toLaneStatus(value: 'pass' | 'fail'): LaneStatus {
  return value === 'pass' ? 'PASS' : 'FAIL';
}

function statusFromScenarios(scenarios: Record<string, { status: 'pass' | 'fail' }>): LaneStatus {
  return Object.values(scenarios).some((scenario) => scenario.status === 'fail') ? 'FAIL' : 'PASS';
}

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function loadCanonicalScenarios(root: string): Canonical {
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const canonical = readJsonIfExists<Canonical>(canonicalPath);
  if (!canonical || !Array.isArray(canonical.providers) || !Array.isArray(canonical.scenarios)) {
    throw new Error(`Invalid or missing canonical test-case definitions at ${canonicalPath}`);
  }
  return { providers: canonical.providers, scenarios: canonical.scenarios };
}

function buildSummary(matrix: LaneRow[]): Record<LaneStatus, number> & { row_count: number } {
  const tally: Record<LaneStatus, number> = { PASS: 0, FAIL: 0, NOT_PASS: 0 };
  for (const row of matrix) {
    for (const cell of row.cells) {
      tally[cell.status] += 1;
    }
  }

  return { ...tally, row_count: matrix.length };
}

function latestScenarioStatusByKey(runs: CoreIntegrationRunRecord[]): Record<string, LaneStatus> {
  const sorted = [...runs].sort((a, b) => {
    const left = `${a.finishedAt}|${a.runId}`;
    const right = `${b.finishedAt}|${b.runId}`;
    return left.localeCompare(right);
  });

  const out: Record<string, LaneStatus> = {};
  for (const run of sorted) {
    for (const [scenarioKey, status] of Object.entries(run.scenarios ?? {})) {
      out[scenarioKey] = status;
    }
  }
  return out;
}

function buildCoreIntegrationPayload(
  lane: 'core' | 'integration',
  canonical: Canonical,
  runs: CoreIntegrationRunRecord[],
): CoreResults | IntegrationResults {
  const generatedAt = nowIso();
  const latestByScenario = latestScenarioStatusByKey(runs);

  const matrix: LaneRow[] = canonical.scenarios.map((scenario) => {
    const status = latestByScenario[scenario.key] ?? 'NOT_PASS';
    const mode = lane === 'core' ? 'deterministic' : 'dashboard';
    return {
      use_case_id: scenario.id,
      title: scenario.title,
      plan_section: scenario.planRef,
      runtime_scope: 'platform',
      cells: [
        {
          category: lane,
          provider: 'none',
          mode,
          gating: true,
          status,
          evidence_links: [],
          notes: [],
          generated_at_utc: generatedAt,
        },
      ],
    };
  });

  return {
    version: '1.0',
    generatedAt,
    generated_at_utc: generatedAt,
    lane,
    status_enum: [...STATUS_ENUM],
    summary: buildSummary(matrix),
    matrix,
    runs: [...runs].slice(-50),
  } as CoreResults | IntegrationResults;
}

function normalizeLiveCells(
  canonical: Canonical,
  existingCells: LiveResults['cells'] | undefined,
): LiveResults['cells'] {
  const cells: LiveResults['cells'] = {};

  for (const scenario of canonical.scenarios) {
    cells[scenario.key] = {};
    for (const provider of canonical.providers) {
      const existing = existingCells?.[scenario.key]?.[provider];
      cells[scenario.key][provider] = existing ? { ...existing } : { status: 'NOT_PASS' };
    }
  }

  return cells;
}

function buildLiveMatrix(canonical: Canonical, cells: LiveResults['cells'], generatedAt: string): LaneRow[] {
  return canonical.scenarios.map((scenario) => {
    const rowCells: LaneCell[] = canonical.providers.map((provider) => {
      const state = cells[scenario.key]?.[provider] ?? { status: 'NOT_PASS' };
      const links = [state.artifactJsonPath, state.artifactMdPath].filter(Boolean) as string[];
      const notes = state.error ? [state.error] : [];

      return {
        category: 'live',
        provider,
        mode: 'e2e',
        gating: true,
        status: state.status,
        evidence_links: links,
        notes,
        generated_at_utc: generatedAt,
      };
    });

    return {
      use_case_id: scenario.id,
      title: scenario.title,
      plan_section: scenario.planRef,
      runtime_scope: 'platform',
      cells: rowCells,
    };
  });
}

function buildLivePayload(canonical: Canonical, existingCells: LiveResults['cells'] | undefined): LiveResults {
  const generatedAt = nowIso();
  const cells = normalizeLiveCells(canonical, existingCells);
  const matrix = buildLiveMatrix(canonical, cells, generatedAt);

  return {
    version: '1.0',
    generatedAt,
    generated_at_utc: generatedAt,
    lane: 'live',
    status_enum: [...STATUS_ENUM],
    summary: buildSummary(matrix),
    matrix,
    providers: [...canonical.providers],
    scenarios: [...canonical.scenarios],
    cells,
  };
}

function updateCoreOrIntegrationResults(
  root: string,
  lane: 'core' | 'integration',
  report: RunReport,
  jsonPath: string,
  mdPath: string,
): void {
  const canonical = loadCanonicalScenarios(root);
  const resultsPath = path.join(root, `tests/reports/${lane}-results.json`);
  const existing = readJsonIfExists<CoreResults | IntegrationResults | { runs?: CoreIntegrationRunRecord[] }>(resultsPath);

  const scenarios = Object.fromEntries(
    Object.entries(report.scenarios).map(([name, result]) => [name, toLaneStatus(result.status)]),
  );

  const runRecord: CoreIntegrationRunRecord = {
    runId: report.runId,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    status: statusFromScenarios(report.scenarios),
    artifactJsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
    artifactMdPath: path.relative(root, mdPath).replaceAll('\\', '/'),
    scenarios,
  };

  const runs = [...(existing?.runs ?? []), runRecord].slice(-50);
  const payload = buildCoreIntegrationPayload(lane, canonical, runs);
  writeJson(resultsPath, payload);
}

function updateLiveResults(root: string, report: RunReport, jsonPath: string, mdPath: string): void {
  const canonical = loadCanonicalScenarios(root);
  const resultsPath = path.join(root, 'tests/reports/live-results.json');
  const existing = readJsonIfExists<LiveResults>(resultsPath);

  const cells = normalizeLiveCells(canonical, existing?.cells);

  for (const [scenarioName, result] of Object.entries(report.scenarios)) {
    if (!cells[scenarioName] || !cells[scenarioName][report.provider]) continue;
    cells[scenarioName][report.provider] = {
      status: toLaneStatus(result.status),
      runId: report.runId,
      artifactJsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
      artifactMdPath: path.relative(root, mdPath).replaceAll('\\', '/'),
      finishedAt: report.finishedAt,
      error: result.error,
    };
  }

  writeJson(resultsPath, buildLivePayload(canonical, cells));
}

export function regenerateLaneResults(root = process.cwd()): void {
  const canonical = loadCanonicalScenarios(root);

  const corePath = path.join(root, 'tests/reports/core-results.json');
  const integrationPath = path.join(root, 'tests/reports/integration-results.json');
  const livePath = path.join(root, 'tests/reports/live-results.json');

  const coreExisting = readJsonIfExists<CoreResults | { runs?: CoreIntegrationRunRecord[] }>(corePath);
  const integrationExisting = readJsonIfExists<IntegrationResults | { runs?: CoreIntegrationRunRecord[] }>(integrationPath);
  const liveExisting = readJsonIfExists<LiveResults>(livePath);

  writeJson(corePath, buildCoreIntegrationPayload('core', canonical, [...(coreExisting?.runs ?? [])]));
  writeJson(
    integrationPath,
    buildCoreIntegrationPayload('integration', canonical, [...(integrationExisting?.runs ?? [])]),
  );
  writeJson(livePath, buildLivePayload(canonical, liveExisting?.cells));
}

export function saveRunReport(report: RunReport): {
  jsonPath: string;
  mdPath: string;
} {
  const root = process.cwd();

  const lane: Lane = resolveLane(report);

  const reportDir = path.join(root, `tests/artifacts/${lane}`);
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(path.join(reportDir, 'screenshots'), { recursive: true });

  const stamp = report.runId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const jsonPath = path.join(reportDir, `run-${stamp}.json`);
  const mdPath = path.join(reportDir, `run-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderHumanReport(report));

  if (lane === 'core') {
    updateCoreOrIntegrationResults(root, 'core', report, jsonPath, mdPath);
  } else if (lane === 'integration') {
    updateCoreOrIntegrationResults(root, 'integration', report, jsonPath, mdPath);
  } else {
    updateLiveResults(root, report, jsonPath, mdPath);
  }

  return { jsonPath, mdPath };
}
