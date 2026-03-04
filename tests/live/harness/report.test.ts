import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { regenerateLaneResults, saveRunReport } from './report.js';

type EnvOverrides = Record<string, string | undefined>;

function withEnv(overrides: EnvOverrides, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function writeCanonical(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        providers: ['openai'],
        scenarios: [
          {
            key: 'sdlc-happy',
            id: 'UC-001',
            title: 'SDLC happy path',
            planRef: 'PLAN-001',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
}

test('regenerateLaneResults uses absolute overrides as-is', { concurrency: false }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-abs-'));
  const canonicalPath = path.join(root, 'canon', 'test-cases.v1.json');
  const absoluteResultsPath = path.join(root, 'outside', 'results.v1.json');
  writeCanonical(canonicalPath);

  withEnv(
    {
      LIVE_CANONICAL_TEST_CASES_PATH: canonicalPath,
      LIVE_REPORTS_RESULTS_PATH: absoluteResultsPath,
      LIVE_ARTIFACTS_ROOT: undefined,
    },
    () => {
      regenerateLaneResults(root);
    },
  );

  assert.equal(existsSync(absoluteResultsPath), true);
  const payload = JSON.parse(readFileSync(absoluteResultsPath, 'utf8')) as { matrix: unknown[] };
  assert.equal(Array.isArray(payload.matrix), true);
  assert.equal(payload.matrix.length, 1);

  const wrongJoinedPath = path.join(root, absoluteResultsPath);
  assert.equal(existsSync(wrongJoinedPath), false);
});

test('relative overrides resolve from cwd repo root for saveRunReport', { concurrency: false }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-rel-'));
  const canonicalRelative = 'custom/cases.v1.json';
  const resultsRelative = 'custom/results.v1.json';
  const artifactsRelative = 'custom/artifacts';

  writeCanonical(path.join(root, canonicalRelative));

  const previousCwd = process.cwd();
  process.chdir(root);

  try {
    withEnv(
      {
        LIVE_CANONICAL_TEST_CASES_PATH: canonicalRelative,
        LIVE_REPORTS_RESULTS_PATH: resultsRelative,
        LIVE_ARTIFACTS_ROOT: artifactsRelative,
      },
      () => {
        const { jsonPath, mdPath } = saveRunReport({
          runId: 'run-relative-1',
          startedAt: '2026-03-03T00:00:00.000Z',
          finishedAt: '2026-03-03T00:00:01.000Z',
          template: 'dashboard',
          provider: 'none',
          repeat: 1,
          scenarios: {
            'sdlc-happy': {
              status: 'pass',
              duration: '1s',
              cost: '0',
              artifacts: 0,
              validations: 1,
              screenshots: [],
            },
          },
          containers_leaked: 0,
          temp_files_leaked: 0,
          total_cost: '0',
        });

        assert.equal(jsonPath, path.join(root, artifactsRelative, 'integration', 'run-run-relative-1.json'));
        assert.equal(mdPath, path.join(root, artifactsRelative, 'integration', 'run-run-relative-1.md'));
      },
    );
  } finally {
    process.chdir(previousCwd);
  }

  assert.equal(existsSync(path.join(root, resultsRelative)), true);
  assert.equal(existsSync(path.join(root, artifactsRelative, 'integration', 'run-run-relative-1.json')), true);
});

test('dashboard-only integration report does not fan out status to canonical scenario cells', {
  concurrency: false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-dashboard-'));
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  writeCanonical(canonicalPath);

  const previousCwd = process.cwd();
  process.chdir(root);

  try {
    saveRunReport({
      runId: 'run-dashboard-1',
      startedAt: '2026-03-03T00:00:00.000Z',
      finishedAt: '2026-03-03T00:00:01.000Z',
      template: 'dashboard',
      provider: 'none',
      repeat: 1,
      scenarios: {
        dashboard: {
          status: 'pass',
          duration: '1s',
          cost: '0',
          artifacts: 0,
          validations: 1,
          screenshots: [],
        },
      },
      containers_leaked: 0,
      temp_files_leaked: 0,
      total_cost: '0',
    });
  } finally {
    process.chdir(previousCwd);
  }

  const payload = JSON.parse(
    readFileSync(path.join(root, 'tests/reports/results.v1.json'), 'utf8'),
  ) as {
    matrix: Array<{ cells: Array<{ lane: string; status: string }> }>;
    runs: { integration: Array<{ scenarios: Record<string, string> }> };
  };

  const integrationCell = payload.matrix[0]?.cells.find((cell) => cell.lane === 'integration');
  assert.equal(integrationCell?.status, 'NOT_PASS');
  assert.equal(payload.runs.integration[0]?.scenarios['dashboard'], 'PASS');
  assert.equal(payload.runs.integration[0]?.scenarios['sdlc-happy'], undefined);
});

test('dashboard integration run keeps canonical scenario statuses with tagged evidence source while matrix stays fail-closed without committed links', {
  concurrency: false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-dashboard-tagged-'));
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  writeCanonical(canonicalPath);

  const previousCwd = process.cwd();
  process.chdir(root);

  try {
    saveRunReport({
      runId: 'run-dashboard-tagged-1',
      startedAt: '2026-03-03T00:00:00.000Z',
      finishedAt: '2026-03-03T00:00:01.000Z',
      template: 'dashboard',
      provider: 'none',
      repeat: 1,
      scenarios: {
        dashboard: {
          status: 'pass',
          duration: '1s',
          cost: '0',
          artifacts: 1,
          validations: 1,
          screenshots: [],
        },
        'sdlc-happy': {
          status: 'pass',
          duration: '1s',
          cost: '0',
          artifacts: 1,
          validations: 1,
          screenshots: [],
        },
      },
      integrationEvidenceSource: 'dashboard-playwright-tags-v1',
      containers_leaked: 0,
      temp_files_leaked: 0,
      total_cost: '0',
    });
  } finally {
    process.chdir(previousCwd);
  }

  const payload = JSON.parse(
    readFileSync(path.join(root, 'tests/reports/results.v1.json'), 'utf8'),
  ) as {
    matrix: Array<{ cells: Array<{ lane: string; status: string; evidence_links?: string[] }> }>;
    runs: { integration: Array<{ scenarios: Record<string, string>; scenarioEvidenceSource?: string }> };
  };

  const integrationCell = payload.matrix[0]?.cells.find((cell) => cell.lane === 'integration');
  assert.equal(integrationCell?.status, 'NOT_PASS');
  assert.deepEqual(integrationCell?.evidence_links, []);
  assert.equal(payload.runs.integration[0]?.scenarios['dashboard'], 'PASS');
  assert.equal(payload.runs.integration[0]?.scenarios['sdlc-happy'], 'PASS');
  assert.equal(payload.runs.integration[0]?.scenarioEvidenceSource, 'dashboard-playwright-tags-v1');
});

test('regenerateLaneResults populates integration PASS evidence links from auditable run metadata', {
  concurrency: false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-integration-links-'));
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const resultsPath = path.join(root, 'tests/reports/results.v1.json');
  writeCanonical(canonicalPath);

  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        version: '1.0',
        generatedAt: '2026-03-03T00:00:00.000Z',
        generated_at_utc: '2026-03-03T00:00:00.000Z',
        status_enum: ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'],
        providers: ['openai'],
        scenarios: [
          {
            key: 'sdlc-happy',
            id: 'UC-001',
            title: 'SDLC happy path',
            planRef: 'PLAN-001',
          },
        ],
        summary: {
          PASS: 0,
          FLAKY: 0,
          FAIL: 0,
          NOT_PASS: 3,
          row_count: 1,
          cell_count: 3,
          by_lane: {
            core: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
            integration: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
            live: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
          },
        },
        matrix: [
          {
            use_case_id: 'UC-001',
            title: 'SDLC happy path',
            plan_section: 'PLAN-001',
            runtime_scope: 'platform',
            cells: [
              { lane: 'core', category: 'core', provider: 'none', mode: 'core', status: 'NOT_PASS' },
              {
                lane: 'integration',
                category: 'integration',
                provider: 'none',
                mode: 'integration',
                status: 'NOT_PASS',
              },
              { lane: 'live', category: 'live', provider: 'openai', mode: 'e2e', status: 'NOT_PASS' },
            ],
          },
        ],
        runs: {
          core: [],
          integration: [
            {
              runId: 'dashboard-tagged-1',
              startedAt: '2026-03-03T00:00:00.000Z',
              finishedAt: '2026-03-03T00:00:01.000Z',
              status: 'PASS',
              artifactJsonPath: 'tests/reports/traceability-run-report.json',
              artifactMdPath: 'tests/reports/traceability-run-markdown.json',
              scenarios: {
                dashboard: 'PASS',
                'sdlc-happy': 'PASS',
              },
              scenarioEvidenceSource: 'dashboard-playwright-tags-v1',
              auditManifestPath: 'tests/reports/traceability-run-manifest.json',
              playwrightReportPath: 'tests/reports/traceability-playwright.json',
              integrationEvidenceLinks: [
                'tests/reports/traceability-run-manifest.json',
                'tests/reports/traceability-run-report.json',
              ],
            },
          ],
        },
        live_cells: {
          'sdlc-happy': {
            openai: {
              status: 'NOT_PASS',
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  regenerateLaneResults(root);

  const payload = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
    matrix: Array<{ cells: Array<{ lane: string; status: string; evidence_links?: string[] }> }>;
  };

  const integrationCell = payload.matrix[0]?.cells.find((cell) => cell.lane === 'integration');
  assert.equal(integrationCell?.status, 'PASS');
  assert.deepEqual(integrationCell?.evidence_links, [
    'tests/reports/traceability-run-manifest.json#scenario=sdlc-happy',
    'tests/reports/traceability-run-manifest.json',
    'tests/reports/traceability-run-report.json',
    'tests/reports/traceability-run-markdown.json',
    'tests/reports/traceability-playwright.json',
  ]);
});

test('regenerateLaneResults downgrades integration PASS without committed auditable evidence links', {
  concurrency: false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-integration-failclosed-'));
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const resultsPath = path.join(root, 'tests/reports/results.v1.json');
  writeCanonical(canonicalPath);

  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        version: '1.0',
        generatedAt: '2026-03-03T00:00:00.000Z',
        generated_at_utc: '2026-03-03T00:00:00.000Z',
        status_enum: ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'],
        providers: ['openai'],
        scenarios: [
          {
            key: 'sdlc-happy',
            id: 'UC-001',
            title: 'SDLC happy path',
            planRef: 'PLAN-001',
          },
        ],
        summary: {
          PASS: 1,
          FLAKY: 0,
          FAIL: 0,
          NOT_PASS: 2,
          row_count: 1,
          cell_count: 3,
          by_lane: {
            core: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
            integration: { PASS: 1, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
            live: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
          },
        },
        matrix: [
          {
            use_case_id: 'UC-001',
            title: 'SDLC happy path',
            plan_section: 'PLAN-001',
            runtime_scope: 'platform',
            cells: [
              { lane: 'core', category: 'core', provider: 'none', mode: 'core', status: 'NOT_PASS' },
              {
                lane: 'integration',
                category: 'integration',
                provider: 'none',
                mode: 'integration',
                status: 'PASS',
              },
              { lane: 'live', category: 'live', provider: 'openai', mode: 'e2e', status: 'NOT_PASS' },
            ],
          },
        ],
        runs: {
          core: [],
          integration: [
            {
              runId: 'dashboard-raw-artifacts-1',
              startedAt: '2026-03-03T00:00:00.000Z',
              finishedAt: '2026-03-03T00:00:01.000Z',
              status: 'PASS',
              artifactJsonPath: 'tests/artifacts/integration/run-dashboard-raw-artifacts-1.json',
              artifactMdPath: 'tests/artifacts/integration/run-dashboard-raw-artifacts-1.md',
              scenarios: {
                dashboard: 'PASS',
                'sdlc-happy': 'PASS',
              },
              scenarioEvidenceSource: 'dashboard-playwright-tags-v1',
            },
          ],
        },
        live_cells: {
          'sdlc-happy': {
            openai: {
              status: 'NOT_PASS',
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  regenerateLaneResults(root);

  const payload = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
    matrix: Array<{ cells: Array<{ lane: string; status: string; evidence_links?: string[] }> }>;
  };

  const integrationCell = payload.matrix[0]?.cells.find((cell) => cell.lane === 'integration');
  assert.equal(integrationCell?.status, 'NOT_PASS');
  assert.deepEqual(integrationCell?.evidence_links, []);
});

test('regenerateLaneResults strips legacy dashboard fan-out from integration history', {
  concurrency: false,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'report-fanout-migrate-'));
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const resultsPath = path.join(root, 'tests/reports/results.v1.json');
  writeCanonical(canonicalPath);

  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        version: '1.0',
        generatedAt: '2026-03-03T00:00:00.000Z',
        generated_at_utc: '2026-03-03T00:00:00.000Z',
        status_enum: ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'],
        providers: ['openai'],
        scenarios: [
          {
            key: 'sdlc-happy',
            id: 'UC-001',
            title: 'SDLC happy path',
            planRef: 'PLAN-001',
          },
        ],
        summary: {
          PASS: 2,
          FLAKY: 0,
          FAIL: 0,
          NOT_PASS: 1,
          row_count: 1,
          cell_count: 3,
          by_lane: {
            core: { PASS: 1, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
            integration: { PASS: 1, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
            live: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 1 },
          },
        },
        matrix: [
          {
            use_case_id: 'UC-001',
            title: 'SDLC happy path',
            plan_section: 'PLAN-001',
            runtime_scope: 'platform',
            cells: [
              { lane: 'core', category: 'core', provider: 'none', mode: 'core', status: 'PASS' },
              {
                lane: 'integration',
                category: 'integration',
                provider: 'none',
                mode: 'integration',
                status: 'PASS',
              },
              { lane: 'live', category: 'live', provider: 'openai', mode: 'e2e', status: 'NOT_PASS' },
            ],
          },
        ],
        runs: {
          core: [],
          integration: [
            {
              runId: 'legacy-dashboard-1',
              startedAt: '2026-03-03T00:00:00.000Z',
              finishedAt: '2026-03-03T00:00:01.000Z',
              status: 'PASS',
              artifactJsonPath: 'tests/artifacts/integration/run-legacy-dashboard-1.json',
              artifactMdPath: 'tests/artifacts/integration/run-legacy-dashboard-1.md',
              scenarios: {
                dashboard: 'PASS',
                'sdlc-happy': 'PASS',
              },
            },
          ],
        },
        live_cells: {
          'sdlc-happy': {
            openai: {
              status: 'NOT_PASS',
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  regenerateLaneResults(root);

  const payload = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
    matrix: Array<{ cells: Array<{ lane: string; status: string }> }>;
    runs: { integration: Array<{ scenarios: Record<string, string> }> };
  };

  const integrationCell = payload.matrix[0]?.cells.find((cell) => cell.lane === 'integration');
  assert.equal(integrationCell?.status, 'NOT_PASS');
  assert.equal(payload.runs.integration[0]?.scenarios['dashboard'], 'PASS');
  assert.equal(payload.runs.integration[0]?.scenarios['sdlc-happy'], undefined);
});
