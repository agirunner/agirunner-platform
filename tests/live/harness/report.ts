import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunReport } from './types.js';

type LaneStatus = 'PASS' | 'FAIL' | 'NOT_PASS';
type Lane = 'core' | 'integration' | 'live';

type ScenarioDef = { key: string; id: string; title: string; planRef: string };

type ResultCell = {
  lane: Lane;
  category: string;
  provider: string;
  mode: string;
  gating: boolean;
  status: LaneStatus;
  evidence_links: string[];
  notes: string[];
  generated_at_utc: string;
};

type ResultRow = {
  use_case_id: string;
  title: string;
  plan_section: string;
  runtime_scope: string;
  cells: ResultCell[];
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

type LiveCell = {
  status: LaneStatus;
  runId?: string;
  artifactJsonPath?: string;
  artifactMdPath?: string;
  finishedAt?: string;
  error?: string;
};

type ConsolidatedResults = {
  version: '1.0';
  generatedAt: string;
  generated_at_utc: string;
  status_enum: LaneStatus[];
  providers: string[];
  scenarios: ScenarioDef[];
  summary: Record<LaneStatus, number> & {
    row_count: number;
    cell_count: number;
    by_lane: Record<Lane, Record<LaneStatus, number>>;
  };
  matrix: ResultRow[];
  runs: {
    core: CoreIntegrationRunRecord[];
    integration: CoreIntegrationRunRecord[];
  };
  live_cells: Record<string, Record<string, LiveCell>>;
};

type Canonical = { providers: string[]; scenarios: ScenarioDef[] };

type LegacyLaneResults = {
  matrix?: Array<{ use_case_id?: string; cells?: Array<{ status?: LaneStatus }> }>;
  runs?: CoreIntegrationRunRecord[];
};

type LegacyLiveResults = {
  matrix?: Array<{
    use_case_id?: string;
    cells?: Array<{ provider?: string; status?: LaneStatus; evidence_links?: string[]; notes?: string[] }>;
  }>;
  cells?: Record<string, Record<string, LiveCell>>;
};

const STATUS_ENUM: LaneStatus[] = ['PASS', 'FAIL', 'NOT_PASS'];
const RESULTS_PATH = 'tests/reports/results.v1.json';

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

function scenarioStatusesFromMatrix(
  canonical: Canonical,
  rows: Array<{ use_case_id?: string; cells?: Array<{ status?: LaneStatus }> }> | undefined,
): Record<string, LaneStatus> {
  const byId = new Map(canonical.scenarios.map((scenario) => [scenario.id, scenario.key]));
  const out: Record<string, LaneStatus> = {};
  for (const row of rows ?? []) {
    const key = byId.get(String(row.use_case_id ?? ''));
    const status = row.cells?.[0]?.status;
    if (!key || !status || !STATUS_ENUM.includes(status)) continue;
    out[key] = status;
  }
  return out;
}

function normalizeLiveCells(
  canonical: Canonical,
  existingCells: Record<string, Record<string, LiveCell>> | undefined,
): Record<string, Record<string, LiveCell>> {
  const cells: Record<string, Record<string, LiveCell>> = {};

  for (const scenario of canonical.scenarios) {
    cells[scenario.key] = {};
    for (const provider of canonical.providers) {
      const existing = existingCells?.[scenario.key]?.[provider];
      cells[scenario.key][provider] = existing ? { ...existing } : { status: 'NOT_PASS' };
    }
  }

  return cells;
}

function migrateLegacyLiveCells(canonical: Canonical, legacy: LegacyLiveResults | undefined): Record<string, Record<string, LiveCell>> {
  if (!legacy) return normalizeLiveCells(canonical, undefined);
  if (legacy.cells && typeof legacy.cells === 'object') {
    return normalizeLiveCells(canonical, legacy.cells);
  }

  const byId = new Map(canonical.scenarios.map((scenario) => [scenario.id, scenario.key]));
  const cells = normalizeLiveCells(canonical, undefined);

  for (const row of legacy.matrix ?? []) {
    const key = byId.get(String(row.use_case_id ?? ''));
    if (!key) continue;

    for (const cell of row.cells ?? []) {
      const provider = String(cell.provider ?? '');
      const status = cell.status;
      if (!canonical.providers.includes(provider)) continue;
      if (!status || !STATUS_ENUM.includes(status)) continue;

      cells[key][provider] = {
        status,
        artifactJsonPath: cell.evidence_links?.[0],
        artifactMdPath: cell.evidence_links?.[1],
        error: cell.notes?.[0],
      };
    }
  }

  return cells;
}

function buildSummary(matrix: ResultRow[]): ConsolidatedResults['summary'] {
  const totals: Record<LaneStatus, number> = { PASS: 0, FAIL: 0, NOT_PASS: 0 };
  const byLane: Record<Lane, Record<LaneStatus, number>> = {
    core: { PASS: 0, FAIL: 0, NOT_PASS: 0 },
    integration: { PASS: 0, FAIL: 0, NOT_PASS: 0 },
    live: { PASS: 0, FAIL: 0, NOT_PASS: 0 },
  };

  let cellCount = 0;

  for (const row of matrix) {
    for (const cell of row.cells) {
      totals[cell.status] += 1;
      byLane[cell.lane][cell.status] += 1;
      cellCount += 1;
    }
  }

  return {
    ...totals,
    row_count: matrix.length,
    cell_count: cellCount,
    by_lane: byLane,
  };
}

function buildConsolidatedPayload(
  canonical: Canonical,
  runs: { core: CoreIntegrationRunRecord[]; integration: CoreIntegrationRunRecord[] },
  liveCellsInput: Record<string, Record<string, LiveCell>>,
  fallback: { core: Record<string, LaneStatus>; integration: Record<string, LaneStatus> },
): ConsolidatedResults {
  const generatedAt = nowIso();
  const coreLatest = latestScenarioStatusByKey(runs.core);
  const integrationLatest = latestScenarioStatusByKey(runs.integration);
  const liveCells = normalizeLiveCells(canonical, liveCellsInput);

  const matrix: ResultRow[] = canonical.scenarios.map((scenario) => {
    const coreStatus = coreLatest[scenario.key] ?? fallback.core[scenario.key] ?? 'NOT_PASS';
    const integrationStatus = integrationLatest[scenario.key] ?? fallback.integration[scenario.key] ?? 'NOT_PASS';

    const cells: ResultCell[] = [
      {
        lane: 'core',
        category: 'core',
        provider: 'none',
        mode: 'deterministic',
        gating: true,
        status: coreStatus,
        evidence_links: [],
        notes: [],
        generated_at_utc: generatedAt,
      },
      {
        lane: 'integration',
        category: 'integration',
        provider: 'none',
        mode: 'dashboard',
        gating: true,
        status: integrationStatus,
        evidence_links: [],
        notes: [],
        generated_at_utc: generatedAt,
      },
      ...canonical.providers.map((provider) => {
        const state = liveCells[scenario.key]?.[provider] ?? { status: 'NOT_PASS' as LaneStatus };
        const links = [state.artifactJsonPath, state.artifactMdPath].filter(Boolean) as string[];
        const notes = state.error ? [state.error] : [];

        return {
          lane: 'live' as const,
          category: 'live',
          provider,
          mode: 'e2e',
          gating: true,
          status: state.status,
          evidence_links: links,
          notes,
          generated_at_utc: generatedAt,
        };
      }),
    ];

    return {
      use_case_id: scenario.id,
      title: scenario.title,
      plan_section: scenario.planRef,
      runtime_scope: 'platform',
      cells,
    };
  });

  return {
    version: '1.0',
    generatedAt,
    generated_at_utc: generatedAt,
    status_enum: [...STATUS_ENUM],
    providers: [...canonical.providers],
    scenarios: [...canonical.scenarios],
    summary: buildSummary(matrix),
    matrix,
    runs: {
      core: [...runs.core].slice(-50),
      integration: [...runs.integration].slice(-50),
    },
    live_cells: liveCells,
  };
}

function readExistingOrLegacyState(root: string, canonical: Canonical): {
  runs: { core: CoreIntegrationRunRecord[]; integration: CoreIntegrationRunRecord[] };
  liveCells: Record<string, Record<string, LiveCell>>;
  fallback: { core: Record<string, LaneStatus>; integration: Record<string, LaneStatus> };
} {
  const consolidatedPath = path.join(root, RESULTS_PATH);
  const consolidated = readJsonIfExists<ConsolidatedResults>(consolidatedPath);

  if (consolidated) {
    const fallbackCore: Record<string, LaneStatus> = {};
    const fallbackIntegration: Record<string, LaneStatus> = {};
    const byId = new Map(canonical.scenarios.map((scenario) => [scenario.id, scenario.key]));

    for (const row of consolidated.matrix ?? []) {
      const key = byId.get(row.use_case_id);
      if (!key) continue;
      for (const cell of row.cells ?? []) {
        if (cell.lane === 'core') fallbackCore[key] = cell.status;
        if (cell.lane === 'integration') fallbackIntegration[key] = cell.status;
      }
    }

    return {
      runs: {
        core: [...(consolidated.runs?.core ?? [])],
        integration: [...(consolidated.runs?.integration ?? [])],
      },
      liveCells: normalizeLiveCells(canonical, consolidated.live_cells),
      fallback: { core: fallbackCore, integration: fallbackIntegration },
    };
  }

  const coreLegacy = readJsonIfExists<LegacyLaneResults>(path.join(root, 'tests/reports/core-results.json'));
  const integrationLegacy = readJsonIfExists<LegacyLaneResults>(path.join(root, 'tests/reports/integration-results.json'));
  const liveLegacy = readJsonIfExists<LegacyLiveResults>(path.join(root, 'tests/reports/live-results.json'));

  return {
    runs: {
      core: [...(coreLegacy?.runs ?? [])],
      integration: [...(integrationLegacy?.runs ?? [])],
    },
    liveCells: migrateLegacyLiveCells(canonical, liveLegacy),
    fallback: {
      core: scenarioStatusesFromMatrix(canonical, coreLegacy?.matrix),
      integration: scenarioStatusesFromMatrix(canonical, integrationLegacy?.matrix),
    },
  };
}

function writeConsolidatedResults(
  root: string,
  canonical: Canonical,
  state: {
    runs: { core: CoreIntegrationRunRecord[]; integration: CoreIntegrationRunRecord[] };
    liveCells: Record<string, Record<string, LiveCell>>;
    fallback: { core: Record<string, LaneStatus>; integration: Record<string, LaneStatus> };
  },
): void {
  const resultsPath = path.join(root, RESULTS_PATH);
  writeJson(resultsPath, buildConsolidatedPayload(canonical, state.runs, state.liveCells, state.fallback));
}

function updateCoreOrIntegrationResults(
  root: string,
  lane: 'core' | 'integration',
  report: RunReport,
  jsonPath: string,
  mdPath: string,
): void {
  const canonical = loadCanonicalScenarios(root);
  const state = readExistingOrLegacyState(root, canonical);

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

  if (lane === 'core') {
    state.runs.core = [...state.runs.core, runRecord].slice(-50);
  } else {
    state.runs.integration = [...state.runs.integration, runRecord].slice(-50);
  }

  writeConsolidatedResults(root, canonical, state);
}

function updateLiveResults(root: string, report: RunReport, jsonPath: string, mdPath: string): void {
  const canonical = loadCanonicalScenarios(root);
  const state = readExistingOrLegacyState(root, canonical);
  state.liveCells = normalizeLiveCells(canonical, state.liveCells);

  for (const [scenarioName, result] of Object.entries(report.scenarios)) {
    if (!state.liveCells[scenarioName] || !state.liveCells[scenarioName][report.provider]) continue;
    state.liveCells[scenarioName][report.provider] = {
      status: toLaneStatus(result.status),
      runId: report.runId,
      artifactJsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
      artifactMdPath: path.relative(root, mdPath).replaceAll('\\', '/'),
      finishedAt: report.finishedAt,
      error: result.error,
    };
  }

  writeConsolidatedResults(root, canonical, state);
}

export function regenerateLaneResults(root = process.cwd()): void {
  const canonical = loadCanonicalScenarios(root);
  const state = readExistingOrLegacyState(root, canonical);
  writeConsolidatedResults(root, canonical, state);
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
