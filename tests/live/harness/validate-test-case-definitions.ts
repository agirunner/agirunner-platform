#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type LaneStatus = 'PASS' | 'FLAKY' | 'FAIL' | 'NOT_PASS';
type Lane = 'core' | 'integration' | 'live';

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

type ResultCell = {
  lane: Lane;
  category: string;
  provider: string;
  mode: string;
  gating: boolean;
  status: LaneStatus;
};

type ResultRow = {
  use_case_id: string;
  cells: ResultCell[];
};

type ConsolidatedResults = {
  matrix?: ResultRow[];
  summary?:
    | (Partial<Record<LaneStatus, number>> & {
        row_count?: number;
        cell_count?: number;
        by_lane?: Partial<Record<Lane, Partial<Record<LaneStatus, number>>>>;
      })
    | undefined;
  scenarios?: ScenarioDef[];
};

const STATUS_ENUM: LaneStatus[] = ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'];

function fail(message: string): never {
  throw new Error(`test-case-definition drift: ${message}`);
}

function parseSingleQuotedArray(source: string, variableName: string): string[] {
  const re = new RegExp(
    `${variableName}\\s*:\\s*ScenarioName\\[]\\s*=\\s*\\[([\\s\\S]*?)\\];`,
    'm',
  );
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

function countStatuses(matrix: ResultRow[]): Record<LaneStatus, number> {
  const counts: Record<LaneStatus, number> = { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 };
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

function countStatusesByLane(matrix: ResultRow[]): Record<Lane, Record<LaneStatus, number>> {
  const counts: Record<Lane, Record<LaneStatus, number>> = {
    core: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
    integration: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
    live: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
  };

  for (const row of matrix) {
    for (const cell of row.cells) {
      counts[cell.lane][cell.status] += 1;
    }
  }

  return counts;
}

function validateConsolidated(payload: ConsolidatedResults, canonical: Canonical): void {
  if (!Array.isArray(payload.matrix)) {
    fail('results.v1.json must contain matrix[]');
  }

  const matrix = payload.matrix;
  if (!payload.summary) {
    fail('results.v1.json must contain summary');
  }

  if (payload.summary.row_count !== matrix.length) {
    fail(
      `summary.row_count=${payload.summary.row_count} must equal matrix length=${matrix.length}`,
    );
  }

  const expectedCellCount = matrix.reduce((sum, row) => sum + row.cells.length, 0);
  if (payload.summary.cell_count !== expectedCellCount) {
    fail(`summary.cell_count=${payload.summary.cell_count} must equal actual=${expectedCellCount}`);
  }

  const canonicalById = new Map(canonical.scenarios.map((s) => [s.id, s]));
  const seenIds = new Set<string>();

  for (const row of matrix) {
    if (!canonicalById.has(row.use_case_id)) {
      fail(`unknown use_case_id in matrix: ${row.use_case_id}`);
    }
    if (seenIds.has(row.use_case_id)) {
      fail(`duplicate matrix row for use_case_id=${row.use_case_id}`);
    }
    seenIds.add(row.use_case_id);

    if (!Array.isArray(row.cells) || row.cells.length === 0) {
      fail(`row ${row.use_case_id} must contain cells`);
    }

    const coreCells = row.cells.filter((cell) => cell.lane === 'core');
    const integrationCells = row.cells.filter((cell) => cell.lane === 'integration');
    const liveCells = row.cells.filter((cell) => cell.lane === 'live');

    if (coreCells.length !== 1) {
      fail(`row ${row.use_case_id} must contain exactly one core lane cell`);
    }
    if (integrationCells.length !== 1) {
      fail(`row ${row.use_case_id} must contain exactly one integration lane cell`);
    }
    if (liveCells.length !== canonical.providers.length) {
      fail(`row ${row.use_case_id} must contain one live cell per provider`);
    }

    const expectedLiveProviders = [...canonical.providers].sort();
    const actualLiveProviders = liveCells.map((cell) => cell.provider).sort();
    assertSetEqual(
      expectedLiveProviders,
      actualLiveProviders,
      `live provider coverage for ${row.use_case_id}`,
    );

    for (const cell of row.cells) {
      if (cell.gating !== true) {
        fail(`row ${row.use_case_id} has non-gating cell`);
      }

      if (
        cell.lane === 'core' &&
        !(cell.category === 'core' && cell.provider === 'none' && cell.mode === 'core')
      ) {
        fail(`row ${row.use_case_id} has invalid core lane cell shape`);
      }

      if (
        cell.lane === 'integration' &&
        !(cell.category === 'integration' && cell.provider === 'none' && cell.mode === 'integration')
      ) {
        fail(`row ${row.use_case_id} has invalid integration lane cell shape`);
      }

      if (cell.lane === 'live' && !(cell.category === 'live' && cell.mode === 'e2e')) {
        fail(`row ${row.use_case_id} has invalid live lane cell shape`);
      }
    }
  }

  const missingRows = canonical.scenarios.map((s) => s.id).filter((id) => !seenIds.has(id));
  if (missingRows.length > 0) {
    fail(`missing matrix rows for use_case_id=[${missingRows.join(', ')}]`);
  }

  const totalCounts = countStatuses(matrix);
  for (const status of STATUS_ENUM) {
    const declared = payload.summary[status];
    if (declared !== totalCounts[status]) {
      fail(`summary.${status}=${declared} must equal actual=${totalCounts[status]}`);
    }
  }

  const byLane = payload.summary.by_lane;
  if (!byLane) {
    fail('summary.by_lane must be present');
  }

  const laneCounts = countStatusesByLane(matrix);
  for (const lane of ['core', 'integration', 'live'] as const) {
    for (const status of STATUS_ENUM) {
      const declared = byLane[lane]?.[status];
      const actual = laneCounts[lane][status];
      if (declared !== actual) {
        fail(`summary.by_lane.${lane}.${status}=${declared} must equal actual=${actual}`);
      }
    }
  }
}

function main(): void {
  const root = process.cwd();
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const runnerPath = path.join(root, 'tests/live/harness/runner.ts');
  const flowPath = path.join(root, 'tests/live/harness/traceability-flow.ts');
  const consolidatedResultsPath = path.join(root, 'tests/reports/results.v1.json');

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

  assertSetEqual(
    canonicalKeys,
    allScenarios.filter((name) => canonicalKeys.includes(name)),
    'canonical->runner ALL_SCENARIOS',
  );
  assertSetEqual(
    canonicalKeys,
    switchCases.filter((name) => canonicalKeys.includes(name)),
    'canonical->runner runScenarioByName cases',
  );

  const flowSource = readFileSync(flowPath, 'utf8');
  if (!flowSource.includes('tests/reports/test-cases.v1.json')) {
    fail('traceability-flow.ts must load tests/reports/test-cases.v1.json');
  }
  if (!flowSource.includes('tests/reports/results.v1.json')) {
    fail('traceability-flow.ts must use tests/reports/results.v1.json');
  }

  if (!existsSync(consolidatedResultsPath)) {
    fail('missing consolidated results file tests/reports/results.v1.json');
  }

  const consolidated = JSON.parse(
    readFileSync(consolidatedResultsPath, 'utf8'),
  ) as ConsolidatedResults;
  validateConsolidated(consolidated, canonical);

  const resultDefs = consolidated.scenarios ?? [];
  const canonicalDigest = canonical.scenarios.map(
    (s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`,
  );
  const resultDigest = resultDefs.map((s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`);
  assertSetEqual(
    canonicalDigest,
    resultDigest,
    'canonical definitions vs tests/reports/results.v1.json',
  );

  console.log(
    `OK: canonical test-case definitions validated (${canonical.scenarios.length} scenarios).`,
  );
}

main();
