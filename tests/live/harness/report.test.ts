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
