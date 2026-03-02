import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunReport } from './types.js';

type LaneStatus = 'PASS' | 'FAIL' | 'NOT_PASS';

type CoreResults = {
  version: '1.0';
  generatedAt: string;
  lane: 'core';
  runs: Array<{
    runId: string;
    startedAt: string;
    finishedAt: string;
    status: LaneStatus;
    artifactJsonPath: string;
    artifactMdPath: string;
    scenarios: Record<string, LaneStatus>;
  }>;
};

type IntegrationResults = {
  version: '1.0';
  generatedAt: string;
  lane: 'integration';
  runs: Array<{
    runId: string;
    startedAt: string;
    finishedAt: string;
    status: LaneStatus;
    artifactJsonPath: string;
    artifactMdPath: string;
    scenarios: Record<string, LaneStatus>;
  }>;
};

type ScenarioDef = { key: string; id: string; title: string; planRef: string };

type LiveResults = {
  version: '1.0';
  generatedAt: string;
  lane: 'live';
  providers: string[];
  scenarios: ScenarioDef[];
  cells: Record<string, Record<string, {
    status: LaneStatus;
    runId?: string;
    artifactJsonPath?: string;
    artifactMdPath?: string;
    finishedAt?: string;
    error?: string;
  }>>;
};

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

function loadCanonicalScenarios(root: string): { providers: string[]; scenarios: ScenarioDef[] } {
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const canonical = readJsonIfExists<{ providers: string[]; scenarios: ScenarioDef[] }>(canonicalPath);
  if (!canonical || !Array.isArray(canonical.providers) || !Array.isArray(canonical.scenarios)) {
    throw new Error(`Invalid or missing canonical test-case definitions at ${canonicalPath}`);
  }
  return { providers: canonical.providers, scenarios: canonical.scenarios };
}

function updateCoreOrIntegrationResults(
  root: string,
  lane: 'core' | 'integration',
  report: RunReport,
  jsonPath: string,
  mdPath: string,
): void {
  const resultsPath = path.join(root, `tests/reports/${lane}-results.json`);
  const existing = readJsonIfExists<CoreResults | IntegrationResults>(resultsPath);

  const scenarios = Object.fromEntries(
    Object.entries(report.scenarios).map(([name, result]) => [name, toLaneStatus(result.status)]),
  );

  const runRecord = {
    runId: report.runId,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    status: statusFromScenarios(report.scenarios),
    artifactJsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
    artifactMdPath: path.relative(root, mdPath).replaceAll('\\', '/'),
    scenarios,
  };

  const payload = {
    version: '1.0' as const,
    generatedAt: new Date().toISOString(),
    lane,
    runs: [...(existing?.runs ?? []), runRecord].slice(-50),
  };

  writeJson(resultsPath, payload);
}

function updateLiveResults(root: string, report: RunReport, jsonPath: string, mdPath: string): void {
  const resultsPath = path.join(root, 'tests/reports/live-results.json');
  const { providers, scenarios } = loadCanonicalScenarios(root);
  const existing = readJsonIfExists<LiveResults>(resultsPath);

  const baselineCells: LiveResults['cells'] = {};
  for (const scenario of scenarios) {
    baselineCells[scenario.key] = {};
    for (const provider of providers) {
      baselineCells[scenario.key][provider] = { status: 'NOT_PASS' };
    }
  }

  const payload: LiveResults = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    lane: 'live',
    providers,
    scenarios,
    cells: existing?.cells ?? baselineCells,
  };

  for (const [scenarioName, result] of Object.entries(report.scenarios)) {
    if (!payload.cells[scenarioName] || !payload.cells[scenarioName][report.provider]) continue;
    payload.cells[scenarioName][report.provider] = {
      status: toLaneStatus(result.status),
      runId: report.runId,
      artifactJsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
      artifactMdPath: path.relative(root, mdPath).replaceAll('\\', '/'),
      finishedAt: report.finishedAt,
      error: result.error,
    };
  }

  writeJson(resultsPath, payload);
}

export function saveRunReport(report: RunReport): {
  jsonPath: string;
  mdPath: string;
} {
  const root = process.cwd();

  const lane: 'core' | 'integration' | 'live' =
    report.provider === 'none' ? 'core' : report.template === 'dashboard' ? 'integration' : 'live';

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
