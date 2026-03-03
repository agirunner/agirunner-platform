#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type LaneStatus = 'PASS' | 'FAIL' | 'NOT_PASS';

type ScenarioDef = {
  key: string;
  id: string;
  title: string;
  planRef: string;
};

type Canonical = {
  version: string;
  providers: string[];
  scenarios: ScenarioDef[];
};

type LaneCell = {
  category: string;
  provider: string;
  mode: string;
  gating: boolean;
  status: LaneStatus;
};

type LaneRow = {
  use_case_id: string;
  cells: LaneCell[];
};

type LaneResults = {
  matrix?: LaneRow[];
  summary?: Partial<Record<LaneStatus, number>> & { row_count?: number };
};

type LiveResults = {
  scenarios?: ScenarioDef[];
};

const STATUS_ENUM: LaneStatus[] = ['PASS', 'FAIL', 'NOT_PASS'];

function fail(message: string): never {
  throw new Error(`test-case-definition drift: ${message}`);
}

function parseSingleQuotedArray(source: string, variableName: string): string[] {
  const re = new RegExp(`${variableName}\\s*:\\s*ScenarioName\\[]\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const match = source.match(re);
  if (!match) fail(`could not find ${variableName} in tests/live/harness/runner.ts`);
  return Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

function parseRunScenarioCases(source: string): string[] {
  const switchStart = source.indexOf('async function runScenarioByName(');
  if (switchStart === -1) fail('runScenarioByName function not found in runner.ts');
  const tail = source.slice(switchStart);
  return Array.from(tail.matchAll(/case '([^']+)':/g), (m) => m[1]);
}

function assertUnique(values: string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    fail(`${label} has duplicate entries: ${Array.from(new Set(duplicates)).join(', ')}`);
  }
}

function assertSetEqual(expected: string[], actual: string[], context: string): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter((v) => !actualSet.has(v));
  const extra = actual.filter((v) => !expectedSet.has(v));

  if (missing.length || extra.length) {
    fail(`${context} mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }
}

function countStatuses(matrix: LaneRow[]): Record<LaneStatus, number> {
  const counts: Record<LaneStatus, number> = { PASS: 0, FAIL: 0, NOT_PASS: 0 };
  for (const row of matrix) {
    for (const cell of row.cells) {
      if (!STATUS_ENUM.includes(cell.status)) {
        fail(`invalid status in matrix for use_case_id=${row.use_case_id}: ${cell.status}`);
      }
      counts[cell.status] += 1;
    }
  }
  return counts;
}

function validateLane(
  lane: 'core' | 'integration' | 'live',
  payload: LaneResults,
  canonical: Canonical,
): void {
  if (!Array.isArray(payload.matrix)) {
    fail(`${lane}: results must contain matrix[]`);
  }

  const matrix = payload.matrix;
  if (!payload.summary) {
    fail(`${lane}: results must contain summary`);
  }

  if (payload.summary.row_count !== matrix.length) {
    fail(`${lane}: summary.row_count=${payload.summary.row_count} must equal matrix length=${matrix.length}`);
  }

  const canonicalById = new Map(canonical.scenarios.map((s) => [s.id, s]));
  const seenIds = new Set<string>();
  for (const row of matrix) {
    if (!canonicalById.has(row.use_case_id)) {
      fail(`${lane}: unknown use_case_id in matrix: ${row.use_case_id}`);
    }
    if (seenIds.has(row.use_case_id)) {
      fail(`${lane}: duplicate matrix row for use_case_id=${row.use_case_id}`);
    }
    seenIds.add(row.use_case_id);
  }

  const missingRows = canonical.scenarios.map((s) => s.id).filter((id) => !seenIds.has(id));
  if (missingRows.length > 0) {
    fail(`${lane}: missing matrix rows for use_case_id=[${missingRows.join(', ')}]`);
  }

  for (const row of matrix) {
    if (!Array.isArray(row.cells) || row.cells.length === 0) {
      fail(`${lane}: row ${row.use_case_id} must contain cells`);
    }

    const expectedProviders = lane === 'live' ? canonical.providers : ['none'];
    const observedProviders = row.cells.map((cell) => cell.provider);

    assertSetEqual(expectedProviders, observedProviders, `${lane}: provider coverage for ${row.use_case_id}`);
    assertUnique(observedProviders, `${lane}: duplicate providers for ${row.use_case_id}`);
  }

  const counts = countStatuses(matrix);
  for (const status of STATUS_ENUM) {
    const declared = payload.summary[status];
    if (declared !== counts[status]) {
      fail(`${lane}: summary.${status}=${declared} must equal actual=${counts[status]}`);
    }
  }
}

function main(): void {
  const root = process.cwd();
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const runnerPath = path.join(root, 'tests/live/harness/runner.ts');
  const flowPath = path.join(root, 'tests/live/harness/traceability-flow.ts');
  const coreResultsPath = path.join(root, 'tests/reports/core-results.json');
  const integrationResultsPath = path.join(root, 'tests/reports/integration-results.json');
  const liveResultsPath = path.join(root, 'tests/reports/live-results.json');

  if (!existsSync(canonicalPath)) fail(`missing canonical file ${canonicalPath}`);
  const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8')) as Canonical;

  if (!Array.isArray(canonical.providers) || canonical.providers.length === 0) {
    fail('canonical providers must be non-empty');
  }
  if (!Array.isArray(canonical.scenarios) || canonical.scenarios.length === 0) {
    fail('canonical scenarios must be non-empty');
  }

  const canonicalKeys = canonical.scenarios.map((scenario) => scenario.key);
  const canonicalIds = canonical.scenarios.map((scenario) => scenario.id);
  assertUnique(canonicalKeys, 'canonical scenario keys');
  assertUnique(canonicalIds, 'canonical scenario IDs');

  const requiredRuntimeExternalCoverage: Array<{ key: string; id: string }> = [
    { key: 'ap2-external-runtime', id: 'AP-2' },
    { key: 'ap4-mixed-workers', id: 'AP-4' },
    { key: 'ap6-runtime-maintenance', id: 'AP-6' },
  ];

  for (const required of requiredRuntimeExternalCoverage) {
    if (!canonicalKeys.includes(required.key) || !canonicalIds.includes(required.id)) {
      fail(
        `canonical runtime-external integration coverage must include ${required.id}/${required.key}`,
      );
    }
  }

  const runnerSource = readFileSync(runnerPath, 'utf8');
  const allScenarios = parseSingleQuotedArray(runnerSource, 'ALL_SCENARIOS');
  const switchCases = parseRunScenarioCases(runnerSource);

  assertSetEqual(canonicalKeys, allScenarios.filter((name) => canonicalKeys.includes(name)), 'canonical->runner ALL_SCENARIOS');
  assertSetEqual(canonicalKeys, switchCases.filter((name) => canonicalKeys.includes(name)), 'canonical->runner runScenarioByName cases');

  const flowSource = readFileSync(flowPath, 'utf8');
  if (!flowSource.includes('tests/reports/test-cases.v1.json')) {
    fail('traceability-flow.ts must load tests/reports/test-cases.v1.json');
  }

  if (!existsSync(coreResultsPath) || !existsSync(integrationResultsPath) || !existsSync(liveResultsPath)) {
    fail('missing one or more lane result files under tests/reports/');
  }

  const core = JSON.parse(readFileSync(coreResultsPath, 'utf8')) as LaneResults;
  const integration = JSON.parse(readFileSync(integrationResultsPath, 'utf8')) as LaneResults;
  const live = JSON.parse(readFileSync(liveResultsPath, 'utf8')) as LaneResults & LiveResults;

  validateLane('core', core, canonical);
  validateLane('integration', integration, canonical);
  validateLane('live', live, canonical);

  const resultDefs = live.scenarios ?? [];
  const canonicalDigest = canonical.scenarios.map((s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`);
  const resultDigest = resultDefs.map((s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`);
  assertSetEqual(canonicalDigest, resultDigest, 'canonical definitions vs tests/reports/live-results.json');

  console.log(`OK: canonical test-case definitions validated (${canonical.scenarios.length} scenarios).`);
}

main();
