import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  filterProvidersWithEnv,
  loadProviderCredentialEnvFiles,
  summaryMarkdown,
} from '../../../scripts/test-batch-lib.mjs';
import {
  buildBatchResultsReport,
  buildBootstrapSteps,
  buildStages,
  runBatch,
} from '../../../scripts/test-batch-runner.mjs';

function loadBatchDefaults() {
  const defaultsPath = path.resolve(process.cwd(), 'tests/batch/defaults.json');
  return JSON.parse(readFileSync(defaultsPath, 'utf8')) as {
    defaultMode: string;
    defaultFailurePolicy: string;
    defaultProviders: string[];
    reportRoot: string;
    parallel: { maxConcurrency: number };
    ports: { postgresBase: number; platformApiBase: number; dashboardBase: number };
    compose: { projectPrefix: string };
    stages: Record<string, unknown>;
  };
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'sequential',
    failurePolicy: 'continue-on-error',
    providers: ['openai'],
    providersExplicit: false,
    requestedProviders: ['openai'],
    skippedProviders: [],
    reportDir: null,
    dryRun: false,
    parallelMax: 1,
    ...overrides,
  };
}

test('buildStages does not leak LIVE_* unit env and injects AP-7-safe AGENT_API_URL for docker lanes', async () => {
  const defaults = loadBatchDefaults();
  const previousAgentApi = process.env.AGENT_API_URL;
  delete process.env.AGENT_API_URL;

  try {
    const stages = await buildStages(
      defaults,
      makeOptions(),
      '2026-03-04T00-00-00-000Z',
      path.resolve('tests/artifacts/batch/run-test'),
    );

    const unit = stages.find((stage) => stage.stageId === 'unit');
    const core = stages.find((stage) => stage.stageId === 'core');
    const integration = stages.find((stage) => stage.stageId === 'integration-dashboard');
    const live = stages.find((stage) => stage.stageId === 'live-openai');

    assert.ok(unit);
    assert.ok(core);
    assert.ok(integration);
    assert.ok(live);

    assert.equal(unit?.env.LIVE_ARTIFACTS_ROOT, undefined);
    assert.equal(unit?.env.LIVE_REPORTS_RESULTS_PATH, undefined);

    assert.equal(core?.env.AGENT_API_URL, `http://127.0.0.1:${core?.ports.platformApi}/execute`);
    assert.equal(live?.env.EXECUTE_ROUTE_MODE, 'execution-backed');
    assert.match(
      String(integration?.env.PLAYWRIGHT_BROWSERS_PATH ?? ''),
      /\.cache\/ms-playwright$/,
    );
  } finally {
    if (previousAgentApi === undefined) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = previousAgentApi;
  }
});

test('buildStages defaults live stage command to warm traceability flow', async () => {
  const defaults = loadBatchDefaults();
  const previousLiveMode = process.env.BATCH_LIVE_STAGE_MODE;
  delete process.env.BATCH_LIVE_STAGE_MODE;

  try {
    const stages = await buildStages(
      defaults,
      makeOptions(),
      '2026-03-04T00-00-00-000Z',
      path.resolve('tests/artifacts/batch/run-test'),
    );

    const live = stages.find((stage) => stage.stageId === 'live-openai');
    assert.deepEqual(live?.command, [
      'pnpm',
      'exec',
      'tsx',
      'tests/live/harness/traceability-flow.ts',
      'run-fast',
      '--provider',
      'openai',
      '--runner-all-scenarios',
    ]);
    assert.equal(live?.liveExecutionMode, 'warm');
  } finally {
    if (previousLiveMode === undefined) delete process.env.BATCH_LIVE_STAGE_MODE;
    else process.env.BATCH_LIVE_STAGE_MODE = previousLiveMode;
  }
});

test('buildStages fails closed when cold mode is requested without documented exception', async () => {
  const defaults = loadBatchDefaults();
  const previousLiveMode = process.env.BATCH_LIVE_STAGE_MODE;
  const previousExceptionReason = process.env.BATCH_COLD_MODE_EXCEPTION_REASON;
  const previousExceptionAlias = process.env.BATCH_COLD_MODE_EXCEPTION;

  process.env.BATCH_LIVE_STAGE_MODE = 'cold';
  delete process.env.BATCH_COLD_MODE_EXCEPTION_REASON;
  delete process.env.BATCH_COLD_MODE_EXCEPTION;

  try {
    await assert.rejects(
      () =>
        buildStages(
          defaults,
          makeOptions(),
          '2026-03-04T00-00-00-000Z',
          path.resolve('tests/artifacts/batch/run-test'),
        ),
      /requires BATCH_COLD_MODE_EXCEPTION_REASON/,
    );
  } finally {
    if (previousLiveMode === undefined) delete process.env.BATCH_LIVE_STAGE_MODE;
    else process.env.BATCH_LIVE_STAGE_MODE = previousLiveMode;

    if (previousExceptionReason === undefined) delete process.env.BATCH_COLD_MODE_EXCEPTION_REASON;
    else process.env.BATCH_COLD_MODE_EXCEPTION_REASON = previousExceptionReason;

    if (previousExceptionAlias === undefined) delete process.env.BATCH_COLD_MODE_EXCEPTION;
    else process.env.BATCH_COLD_MODE_EXCEPTION = previousExceptionAlias;
  }
});

test('buildStages preserves explicit AGENT_API_URL override for docker lanes', async () => {
  const defaults = loadBatchDefaults();
  const previousAgentApi = process.env.AGENT_API_URL;
  const previousExecuteRouteMode = process.env.EXECUTE_ROUTE_MODE;
  const previousLiveMode = process.env.BATCH_LIVE_STAGE_MODE;
  const previousExceptionReason = process.env.BATCH_COLD_MODE_EXCEPTION_REASON;

  process.env.AGENT_API_URL = 'http://example.invalid:19000/execute';
  process.env.EXECUTE_ROUTE_MODE = 'live-agent-api';
  process.env.BATCH_LIVE_STAGE_MODE = 'cold';
  process.env.BATCH_COLD_MODE_EXCEPTION_REASON = 'INC-12345 temporary provider outage repro';

  try {
    const stages = await buildStages(
      defaults,
      makeOptions(),
      '2026-03-04T00-00-00-000Z',
      path.resolve('tests/artifacts/batch/run-test'),
    );

    const live = stages.find((stage) => stage.stageId === 'live-openai');
    assert.equal(live?.env.AGENT_API_URL, 'http://example.invalid:19000/execute');
    assert.equal(live?.env.EXECUTE_ROUTE_MODE, 'live-agent-api');
    assert.equal(live?.liveExecutionMode, 'cold');
    assert.match(String(live?.coldModeExceptionReason ?? ''), /INC-12345/);
  } finally {
    if (previousAgentApi === undefined) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = previousAgentApi;

    if (previousExecuteRouteMode === undefined) delete process.env.EXECUTE_ROUTE_MODE;
    else process.env.EXECUTE_ROUTE_MODE = previousExecuteRouteMode;

    if (previousLiveMode === undefined) delete process.env.BATCH_LIVE_STAGE_MODE;
    else process.env.BATCH_LIVE_STAGE_MODE = previousLiveMode;

    if (previousExceptionReason === undefined) delete process.env.BATCH_COLD_MODE_EXCEPTION_REASON;
    else process.env.BATCH_COLD_MODE_EXCEPTION_REASON = previousExceptionReason;
  }
});

test('buildStages allocates deterministic unique docker ports per stage in parallel mode', async () => {
  const defaults = loadBatchDefaults();
  const blocked = new Set([5540, 8140, 3140]);

  const stages = await buildStages(
    defaults,
    makeOptions({
      mode: 'parallel',
      parallelMax: 4,
      providers: ['openai', 'google'],
      requestedProviders: ['openai', 'google'],
    }),
    '2026-03-04T00-00-00-000Z',
    path.resolve('tests/artifacts/batch/run-test'),
    {
      portAvailabilityProbe: async (port: number) => !blocked.has(port),
    },
  );

  const dockerStages = stages.filter((stage) => stage.docker);
  assert.deepEqual(
    dockerStages.map((stage) => stage.stageId),
    ['core', 'integration-dashboard', 'live-openai', 'live-google'],
  );

  assert.deepEqual(
    dockerStages.map((stage) => stage.ports),
    [
      { postgres: 5541, platformApi: 8141, dashboard: 3141 },
      { postgres: 5542, platformApi: 8142, dashboard: 3142 },
      { postgres: 5543, platformApi: 8143, dashboard: 3143 },
      { postgres: 5544, platformApi: 8144, dashboard: 3144 },
    ],
  );
});

test('buildStages creates explicit skipped live stages when providers are missing credentials', async () => {
  const defaults = loadBatchDefaults();

  const stages = await buildStages(
    defaults,
    makeOptions({
      mode: 'parallel',
      providers: ['google'],
      requestedProviders: ['openai', 'google'],
      skippedProviders: [{ provider: 'openai', keys: ['OPENAI_API_KEY'] }],
    }),
    '2026-03-04T00-00-00-000Z',
    path.resolve('tests/artifacts/batch/run-test'),
  );

  const skippedOpenAi = stages.find((stage) => stage.stageId === 'live-openai');
  assert.ok(skippedOpenAi);
  assert.equal(skippedOpenAi?.skip?.reason, 'missing-provider-credentials');
  assert.deepEqual(skippedOpenAi?.skip?.missingCredentialKeys, ['OPENAI_API_KEY']);
});

test('runBatch materializes skipped-stage placeholder artifacts for truthful path claims', async () => {
  const defaults = loadBatchDefaults();
  const reportDir = mkdtempSync(path.join(tmpdir(), 'batch-skipped-placeholders-'));
  const runId = '2026-03-04T00-00-00-000Z';

  try {
    const stage = {
      stageId: 'live-openai',
      label: 'Live OpenAI',
      lane: 'live',
      provider: 'openai',
      command: ['pnpm', 'test:live', '--provider', 'openai'],
      docker: true,
      logs: {
        stdout: path.join(reportDir, 'stages', 'live-openai', 'stdout.log'),
        stderr: path.join(reportDir, 'stages', 'live-openai', 'stderr.log'),
      },
      artifacts: {
        laneArtifactsRoot: path.join(reportDir, 'lanes', 'live-openai', 'artifacts'),
        laneResultsPath: path.join(reportDir, 'lanes', 'live-openai', 'results.v1.json'),
      },
      env: {},
      skip: {
        reason: 'missing-provider-credentials',
        missingCredentialKeys: ['OPENAI_API_KEY'],
        detail: 'Missing provider credentials: openai(OPENAI_API_KEY)',
      },
    };

    const summary = await runBatch(
      makeOptions({
        dryRun: false,
        providers: [],
        requestedProviders: ['openai'],
        skippedProviders: [{ provider: 'openai', keys: ['OPENAI_API_KEY'] }],
        batchResultsPath: path.join(reportDir, 'batch-results.v1.json'),
      }),
      defaults,
      runId,
      reportDir,
      [stage],
    );

    assert.equal(summary.stages[0]?.status, 'skipped');
    assert.equal(summary.stages[0]?.notRunReason, 'missing-provider-credentials');
    assert.equal(summary.artifacts.batchResultsPath, path.join(reportDir, 'batch-results.v1.json'));
    assert.equal(existsSync(stage.logs.stdout), true);
    assert.equal(existsSync(stage.logs.stderr), true);
    assert.equal(existsSync(stage.artifacts.laneArtifactsRoot), true);
    assert.equal(existsSync(stage.artifacts.laneResultsPath), true);

    const laneResults = JSON.parse(readFileSync(stage.artifacts.laneResultsPath, 'utf8')) as {
      placeholder?: boolean;
      status?: string;
      notRunReason?: string;
    };
    assert.equal(laneResults.placeholder, true);
    assert.equal(laneResults.status, 'skipped');
    assert.equal(laneResults.notRunReason, 'missing-provider-credentials');

    const stageReport = JSON.parse(
      readFileSync(path.join(reportDir, 'stages', 'live-openai', 'stage.json'), 'utf8'),
    ) as {
      logs: { stdout: string; stderr: string };
      artifacts: { laneArtifactsRoot: string; laneResultsPath: string };
    };

    assert.equal(existsSync(stageReport.logs.stdout), true);
    assert.equal(existsSync(stageReport.logs.stderr), true);
    assert.equal(existsSync(stageReport.artifacts.laneArtifactsRoot), true);
    assert.equal(existsSync(stageReport.artifacts.laneResultsPath), true);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});

test('summaryMarkdown renders skipped provider metadata and summary artifact evidence paths', () => {
  const markdown = summaryMarkdown({
    runId: 'run-1',
    mode: 'parallel',
    failurePolicy: 'continue-on-error',
    requestedProviders: ['openai', 'google'],
    providers: ['google'],
    skippedProviders: [{ provider: 'openai', keys: ['OPENAI_API_KEY'] }],
    dryRun: false,
    finalExitCode: 0,
    durationMs: 123,
    stageTotals: { pass: 1, fail: 0, infraFail: 0, skipped: 1 },
    artifacts: {
      runManifestPath: '/tmp/run-manifest.json',
      summaryJsonPath: '/tmp/summary.json',
      summaryMarkdownPath: '/tmp/summary.md',
    },
    stages: [
      {
        stageId: 'live-openai',
        status: 'skipped',
        exitCode: undefined,
        durationMs: 0,
        notRunReason: 'missing-provider-credentials',
      },
    ],
  });

  assert.match(markdown, /Skipped providers \(missing credentials\): openai/);
  assert.match(markdown, /Summary JSON: \/tmp\/summary\.json/);
  assert.match(markdown, /\| live-openai \| skipped \|  \| 0 \| missing-provider-credentials \|/);
});

test('buildBatchResultsReport emits results.v1-compatible shape without batch-only metadata', () => {
  const reportDir = mkdtempSync(path.join(tmpdir(), 'batch-canonical-report-'));
  const coreLaneResultsPath = path.join(reportDir, 'core-results.v1.json');
  const integrationLaneResultsPath = path.join(reportDir, 'integration-results.v1.json');
  const liveLaneResultsPath = path.join(reportDir, 'live-results.v1.json');

  try {
    const scenarioDefinition = {
      id: 'AP-1',
      key: 'sdlc-happy',
      title: 'Built-in Worker — SDLC Pipeline',
      planRef: '§2 AP-1',
    };

    writeFileSync(
      coreLaneResultsPath,
      JSON.stringify(
        {
          version: '1.0',
          generatedAt: '2026-03-04T17:30:00.000Z',
          scenarios: [scenarioDefinition],
          runs: {
            core: [
              {
                runId: 'core-run-1',
                startedAt: '2026-03-04T17:29:00.000Z',
                finishedAt: '2026-03-04T17:30:00.000Z',
                status: 'PASS',
                artifactJsonPath: 'tests/artifacts/core-run.json',
                artifactMdPath: 'tests/artifacts/core-run.md',
                scenarios: {
                  'sdlc-happy': 'PASS',
                },
              },
            ],
            integration: [],
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      integrationLaneResultsPath,
      JSON.stringify(
        {
          version: '1.0',
          generatedAt: '2026-03-04T17:31:00.000Z',
          scenarios: [scenarioDefinition],
          runs: {
            core: [],
            integration: [
              {
                runId: 'integration-run-1',
                startedAt: '2026-03-04T17:30:00.000Z',
                finishedAt: '2026-03-04T17:31:00.000Z',
                status: 'PASS',
                artifactJsonPath: 'tests/artifacts/integration-run.json',
                artifactMdPath: 'tests/artifacts/integration-run.md',
                auditManifestPath: 'tests/reports/traceability-integration.json',
                scenarios: {
                  'sdlc-happy': 'PASS',
                },
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      liveLaneResultsPath,
      JSON.stringify(
        {
          version: '1.0',
          generatedAt: '2026-03-04T17:31:00.000Z',
          scenarios: [scenarioDefinition],
          live_cells: {
            'sdlc-happy': {
              openai: {
                status: 'FAIL',
                artifactJsonPath: 'tests/artifacts/live-run.json',
                artifactMdPath: 'tests/artifacts/live-run.md',
                runId: 'live-run-1',
                finishedAt: '2026-03-04T17:31:00.000Z',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const report = buildBatchResultsReport({
      providers: ['openai'],
      requestedProviders: ['openai'],
      stages: [
        {
          stageId: 'core',
          stageLabel: 'core',
          lane: 'core',
          provider: 'none',
          artifacts: {
            laneResultsPath: coreLaneResultsPath,
          },
        },
        {
          stageId: 'integration-dashboard',
          stageLabel: 'integration-dashboard',
          lane: 'integration',
          provider: 'none',
          artifacts: {
            laneResultsPath: integrationLaneResultsPath,
          },
        },
        {
          stageId: 'live-openai',
          stageLabel: 'live-openai',
          lane: 'live',
          provider: 'openai',
          artifacts: {
            laneResultsPath: liveLaneResultsPath,
          },
        },
      ],
    });

    assert.deepEqual(Object.keys(report).sort(), [
      'generatedAt',
      'generated_at_utc',
      'live_cells',
      'matrix',
      'providers',
      'runs',
      'scenarios',
      'status_enum',
      'summary',
      'version',
    ]);

    assert.equal('metadata' in report, false);
    assert.equal(report.providers.length, 1);
    assert.equal(report.providers[0], 'openai');

    const row = report.matrix.find((entry) => entry.use_case_id === 'AP-1');
    assert.ok(row);
    assert.equal(row?.cells.find((cell) => cell.lane === 'core')?.status, 'PASS');
    assert.equal(row?.cells.find((cell) => cell.lane === 'integration')?.status, 'PASS');
    assert.equal(
      row?.cells.find((cell) => cell.lane === 'live' && cell.provider === 'openai')?.status,
      'FAIL',
    );

    assert.equal(report.live_cells['sdlc-happy']?.openai?.status, 'FAIL');
    assert.equal(report.summary.row_count, report.scenarios.length);
    assert.equal(report.summary.cell_count, report.matrix.reduce((sum, item) => sum + item.cells.length, 0));
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});

test('filterProvidersWithEnv drops providers without credentials in non-strict mode', () => {
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;

  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini';

  try {
    const result = filterProvidersWithEnv(['openai', 'google'], false);
    assert.deepEqual(result.selected, ['google']);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]?.provider, 'openai');
  } finally {
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test('loadProviderCredentialEnvFiles loads provider credentials from deterministic override path', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'batch-credential-bootstrap-'));
  const envFilePath = path.join(tempRoot, 'google-test.env');

  const prevBatchGoogleEnv = process.env.BATCH_GOOGLE_ENV_FILE;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;

  writeFileSync(envFilePath, 'GOOGLE_API_KEY=batch-google-key\n');
  process.env.BATCH_GOOGLE_ENV_FILE = envFilePath;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const loaded = loadProviderCredentialEnvFiles(['google']);
    assert.deepEqual(loaded, [envFilePath]);
    assert.equal(process.env.GOOGLE_API_KEY, 'batch-google-key');
  } finally {
    if (prevBatchGoogleEnv === undefined) delete process.env.BATCH_GOOGLE_ENV_FILE;
    else process.env.BATCH_GOOGLE_ENV_FILE = prevBatchGoogleEnv;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildBootstrapSteps plans dependency + playwright bootstrap deterministically', () => {
  const steps = buildBootstrapSteps([], {
    workspaceInstallRequired: true,
    requiresPlaywright: true,
  });

  assert.deepEqual(
    steps.map((step) => step.id),
    ['workspace-install', 'playwright-install-chromium'],
  );
  assert.equal(steps[1]?.env.PLAYWRIGHT_BROWSERS_PATH?.endsWith('.cache/ms-playwright'), true);
});
