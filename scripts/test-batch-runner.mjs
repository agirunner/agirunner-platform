import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
  ROOT,
  nowIso,
  slug,
  stageMarkdown,
  summaryMarkdown,
  tailCollector,
  writeJson,
} from './test-batch-lib.mjs';

const PLAYWRIGHT_BROWSERS_PATH = path.join(ROOT, '.cache', 'ms-playwright');
const BATCH_CANONICAL_RESULTS_PATH = path.join(ROOT, 'tests', 'reports', 'batch-results.v1.json');
const BATCH_CANONICAL_TEST_CASES_PATH = path.join(ROOT, 'tests', 'reports', 'test-cases.v1.json');

const BATCH_LIVE_STAGE_MODE_ENV = 'BATCH_LIVE_STAGE_MODE';
const BATCH_COLD_MODE_EXCEPTION_REASON_ENV = 'BATCH_COLD_MODE_EXCEPTION_REASON';
const BATCH_COLD_MODE_EXCEPTION_ALIAS_ENV = 'BATCH_COLD_MODE_EXCEPTION';
const WARM_LIVE_STAGE_COMMAND = [
  'pnpm',
  'exec',
  'tsx',
  'tests/live/harness/traceability-flow.ts',
  'run-fast',
  '--provider',
  '__PROVIDER__',
  '--runner-all-scenarios',
];

function resolveLiveStageExecutionPolicy(env = process.env) {
  const requestedMode = (env[BATCH_LIVE_STAGE_MODE_ENV] ?? 'warm').trim().toLowerCase();

  if (!requestedMode || requestedMode === 'warm') {
    return { mode: 'warm' };
  }

  if (requestedMode !== 'cold') {
    throw new Error(
      `${BATCH_LIVE_STAGE_MODE_ENV} must be "warm" (default) or "cold" (received: ${JSON.stringify(
        env[BATCH_LIVE_STAGE_MODE_ENV],
      )}).`,
    );
  }

  const exceptionReason =
    env[BATCH_COLD_MODE_EXCEPTION_REASON_ENV]?.trim() ||
    env[BATCH_COLD_MODE_EXCEPTION_ALIAS_ENV]?.trim() ||
    '';

  if (!exceptionReason) {
    throw new Error(
      `${BATCH_LIVE_STAGE_MODE_ENV}=cold requires ${BATCH_COLD_MODE_EXCEPTION_REASON_ENV} ` +
        '(document incident/ticket/exception rationale).',
    );
  }

  console.warn(
    `[test-batch] warning: cold live stage mode enabled by exception (${exceptionReason}).`,
  );

  return {
    mode: 'cold',
    exceptionReason,
  };
}

function resolveLiveStageCommand(defaultCommand, policy) {
  if (policy.mode === 'warm') {
    return [...WARM_LIVE_STAGE_COMMAND];
  }

  return [...defaultCommand];
}

function needsWorkspaceInstall() {
  if (!existsSync(path.join(ROOT, 'node_modules', '.pnpm'))) {
    return true;
  }

  const probe = spawnSync(
    'pnpm',
    ['--filter', '@agirunner/sdk', 'exec', 'vitest', '--version'],
    {
      cwd: ROOT,
      stdio: 'ignore',
    },
  );

  return probe.status !== 0;
}

function runBootstrapStep(step, reportDir) {
  const logRoot = path.join(reportDir, 'bootstrap');
  mkdirSync(logRoot, { recursive: true });

  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: ROOT,
    env: { ...process.env, ...step.env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  const stdoutPath = path.join(logRoot, `${step.id}.stdout.log`);
  const stderrPath = path.join(logRoot, `${step.id}.stderr.log`);
  writeFileSync(stdoutPath, result.stdout ?? '');
  writeFileSync(stderrPath, result.stderr ?? '');

  if (result.status === 0) {
    return;
  }

  const detail = (result.stderr ?? result.stdout ?? '').trim();
  throw new Error(
    `Batch bootstrap step "${step.id}" failed (exit=${result.status ?? 'null'}). ` +
      `Command: ${step.command.join(' ')}. ` +
      `Logs: ${stdoutPath}, ${stderrPath}. ` +
      (detail ? `Detail: ${detail}` : ''),
  );
}

export function buildBootstrapSteps(stages, probes = {}) {
  const steps = [];

  const workspaceInstallRequired =
    probes.workspaceInstallRequired === undefined
      ? needsWorkspaceInstall()
      : probes.workspaceInstallRequired;

  if (workspaceInstallRequired) {
    steps.push({
      id: 'workspace-install',
      command: ['pnpm', 'install', '--frozen-lockfile'],
      env: {},
    });
  }

  const requiresPlaywright =
    probes.requiresPlaywright === undefined
      ? stages.some((stage) => stage.stageId === 'integration-dashboard')
      : probes.requiresPlaywright;

  if (requiresPlaywright) {
    steps.push({
      id: 'playwright-install-chromium',
      command: ['pnpm', 'exec', 'playwright', 'install', 'chromium'],
      env: { PLAYWRIGHT_BROWSERS_PATH },
    });
  }

  return steps;
}

function ensureBatchPrerequisites(options, reportDir, stages) {
  if (options.dryRun) return;

  const steps = buildBootstrapSteps(stages);
  for (const step of steps) {
    runBootstrapStep(step, reportDir);
  }
}

async function isPortAvailable(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => resolve(false));
    server.listen({ host: '0.0.0.0', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocateAvailablePort(preferredPort, reservedPorts, portAvailabilityProbe) {
  for (let port = preferredPort; port <= 65_535; port += 1) {
    if (reservedPorts.has(port)) continue;
    if (!(await portAvailabilityProbe(port))) continue;

    reservedPorts.add(port);
    return port;
  }

  throw new Error(`Unable to allocate available port from base ${preferredPort}`);
}

async function allocateStagePorts(defaults, offset, reservedPorts, portAvailabilityProbe) {
  return {
    postgres: await allocateAvailablePort(
      Number(defaults.ports.postgresBase) + offset,
      reservedPorts,
      portAvailabilityProbe,
    ),
    platformApi: await allocateAvailablePort(
      Number(defaults.ports.platformApiBase) + offset,
      reservedPorts,
      portAvailabilityProbe,
    ),
    dashboard: await allocateAvailablePort(
      Number(defaults.ports.dashboardBase) + offset,
      reservedPorts,
      portAvailabilityProbe,
    ),
  };
}

function missingProviderSkip(providerRecord) {
  const keys = providerRecord.keys ?? [];
  return {
    reason: 'missing-provider-credentials',
    missingCredentialKeys: keys,
    detail: `Missing provider credentials: ${providerRecord.provider}(${keys.join('|')})`,
  };
}

export async function buildStages(defaults, options, runId, reportDir, probes = {}) {
  const stages = [];
  const stageDefs = defaults.stages;
  const portAvailabilityProbe = probes.portAvailabilityProbe ?? isPortAvailable;
  const liveStagePolicy = resolveLiveStageExecutionPolicy();
  const liveStageCommandTemplate = resolveLiveStageCommand(stageDefs.live.command, liveStagePolicy);

  stages.push({ stageId: 'unit', lane: 'unit', provider: 'none', ...stageDefs.unit });
  stages.push({ stageId: 'core', lane: 'core', provider: 'none', ...stageDefs.core });
  stages.push({
    stageId: 'integration-dashboard',
    lane: 'integration',
    provider: 'none',
    ...stageDefs.integrationDashboard,
  });

  for (const provider of options.providers) {
    stages.push({
      stageId: `live-${provider}`,
      lane: 'live',
      provider,
      ...stageDefs.live,
      command: liveStageCommandTemplate.map((part) => (part === '__PROVIDER__' ? provider : part)),
      liveExecutionMode: liveStagePolicy.mode,
      coldModeExceptionReason: liveStagePolicy.exceptionReason,
    });
  }

  for (const providerRecord of options.skippedProviders ?? []) {
    const provider = providerRecord.provider;
    stages.push({
      stageId: `live-${provider}`,
      lane: 'live',
      provider,
      ...stageDefs.live,
      command: liveStageCommandTemplate.map((part) => (part === '__PROVIDER__' ? provider : part)),
      liveExecutionMode: liveStagePolicy.mode,
      coldModeExceptionReason: liveStagePolicy.exceptionReason,
      skip: missingProviderSkip(providerRecord),
    });
  }

  const shouldIsolateParallelPorts = options.mode === 'parallel';
  const sharedParallelPorts = new Set();
  let dockerStageIndex = 0;

  for (const stage of stages) {
    const safeStageId = slug(stage.stageId);
    const laneRoot = path.join(reportDir, 'lanes', safeStageId);

    stage.logs = {
      stdout: path.join(reportDir, 'stages', safeStageId, 'stdout.log'),
      stderr: path.join(reportDir, 'stages', safeStageId, 'stderr.log'),
    };
    stage.artifacts = {
      laneArtifactsRoot: path.join(laneRoot, 'artifacts'),
      laneResultsPath: path.join(laneRoot, 'results.v1.json'),
    };

    stage.env = {};

    if (stage.lane !== 'unit') {
      Object.assign(stage.env, {
        LIVE_ARTIFACTS_ROOT: stage.artifacts.laneArtifactsRoot,
        LIVE_REPORTS_RESULTS_PATH: stage.artifacts.laneResultsPath,
        LIVE_BUILD_CACHE_PATH: path.join(reportDir, 'compose-build-fingerprint.v1.json'),
        LIVE_TMP_PREFIX: `/tmp/agirunner-live-${slug(runId)}-${safeStageId}-`,
      });
    }

    if (stage.stageId === 'integration-dashboard') {
      stage.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
    }

    if (stage.docker) {
      const offset = shouldIsolateParallelPorts ? dockerStageIndex : 0;
      const reservedPorts = shouldIsolateParallelPorts ? sharedParallelPorts : new Set();
      const ports = await allocateStagePorts(
        defaults,
        offset,
        reservedPorts,
        portAvailabilityProbe,
      );
      dockerStageIndex += 1;

      const explicitAgentApiUrl = process.env.AGENT_API_URL?.trim();

      stage.ports = ports;
      stage.composeProjectName = `${slug(defaults.compose.projectPrefix)}-${slug(runId)}-${safeStageId}`;

      Object.assign(stage.env, {
        COMPOSE_PROJECT_NAME: stage.composeProjectName,
        POSTGRES_PORT: String(ports.postgres),
        PLATFORM_API_PORT: String(ports.platformApi),
        DASHBOARD_PORT: String(ports.dashboard),
        LIVE_API_BASE_URL: `http://127.0.0.1:${ports.platformApi}`,
        LIVE_DASHBOARD_BASE_URL: `http://127.0.0.1:${ports.dashboard}`,
        LIVE_POSTGRES_URL: `postgresql://agirunner:agirunner@127.0.0.1:${ports.postgres}/agirunner`,
        VITE_PLATFORM_API_URL: `http://127.0.0.1:${ports.platformApi}`,
        RATE_LIMIT_MAX_PER_MINUTE: process.env.RATE_LIMIT_MAX_PER_MINUTE || '1000',
        LIVE_COMPOSE_MIN_FREE_GB: process.env.LIVE_COMPOSE_MIN_FREE_GB || '3',
        ...(explicitAgentApiUrl ? { AGENT_API_URL: explicitAgentApiUrl } : {}),
        ...(process.env.RUNTIME_API_KEY
          ? { RUNTIME_API_KEY: process.env.RUNTIME_API_KEY }
          : {}),
      });
    }
  }

  return stages;
}

function stageClaimedPaths(entry) {
  return [
    { label: 'stdout log', filePath: entry.logs?.stdout },
    { label: 'stderr log', filePath: entry.logs?.stderr },
    { label: 'lane artifacts root', filePath: entry.artifacts?.laneArtifactsRoot },
    { label: 'lane results path', filePath: entry.artifacts?.laneResultsPath },
  ].filter(({ filePath }) => typeof filePath === 'string' && filePath.length > 0);
}

function assertClaimedPathsExist(entry, contextLabel) {
  for (const { label, filePath } of stageClaimedPaths(entry)) {
    if (!existsSync(filePath)) {
      throw new Error(`${contextLabel} claims ${label} that does not exist: ${filePath}`);
    }
  }
}

function materializeClaimedPathPlaceholders(report) {
  const reason = report.notRunReason ?? report.skip?.reason ?? report.status;
  const baseMessage = `[${report.status}] stage=${report.stageId} reason=${reason}`;

  if (report.logs?.stdout) {
    mkdirSync(path.dirname(report.logs.stdout), { recursive: true });
    if (!existsSync(report.logs.stdout)) {
      writeFileSync(report.logs.stdout, `${baseMessage}\n`);
    }
  }

  if (report.logs?.stderr) {
    mkdirSync(path.dirname(report.logs.stderr), { recursive: true });
    if (!existsSync(report.logs.stderr)) {
      writeFileSync(report.logs.stderr, `${baseMessage}\n`);
    }
  }

  if (report.artifacts?.laneArtifactsRoot) {
    mkdirSync(report.artifacts.laneArtifactsRoot, { recursive: true });
  }

  if (report.artifacts?.laneResultsPath) {
    mkdirSync(path.dirname(report.artifacts.laneResultsPath), { recursive: true });
    if (!existsSync(report.artifacts.laneResultsPath)) {
      writeJson(report.artifacts.laneResultsPath, {
        version: '1.0',
        stageId: report.stageId,
        status: report.status,
        notRunReason: report.notRunReason,
        generatedAt: nowIso(),
        placeholder: true,
      });
    }
  }
}

function writeStageReport(stage, report) {
  materializeClaimedPathPlaceholders(report);
  assertClaimedPathsExist(report, `Stage report ${report.stageId}`);

  const base = path.join(path.dirname(stage.logs.stdout), 'stage');
  writeJson(`${base}.json`, report);
  writeFileSync(`${base}.md`, stageMarkdown(report));
}

function skippedStageReport(stage, options, runId, notRunReason) {
  return {
    version: '1.0',
    runId,
    stageId: stage.stageId,
    stageLabel: stage.label,
    lane: stage.lane,
    provider: stage.provider,
    mode: options.mode,
    failurePolicy: options.failurePolicy,
    status: 'skipped',
    command: stage.command,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationMs: 0,
    logs: stage.logs,
    artifacts: stage.artifacts,
    ports: stage.ports,
    composeProjectName: stage.composeProjectName,
    liveExecutionMode: stage.liveExecutionMode,
    coldModeExceptionReason: stage.coldModeExceptionReason,
    notRunReason,
    skip: stage.skip,
  };
}

async function runStage(stage, options, runId) {
  const startedAt = nowIso();
  const startedMs = Date.now();

  mkdirSync(path.dirname(stage.logs.stdout), { recursive: true });
  const stdoutStream = createWriteStream(stage.logs.stdout);
  const stderrStream = createWriteStream(stage.logs.stderr);
  const stdoutTail = tailCollector();
  const stderrTail = tailCollector();

  const env = { ...process.env, ...stage.env, BATCH_RUN_ID: runId };
  const child = spawn(stage.command[0], stage.command.slice(1), {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    stdoutStream.write(chunk);
    stdoutTail.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrStream.write(chunk);
    stderrTail.push(chunk);
  });

  const stageStatus = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ type: 'infra-fail', exitCode: 2, error }));
    child.once('close', (exitCode) => {
      if (exitCode === 0) resolve({ type: 'pass', exitCode: 0 });
      else resolve({ type: 'fail', exitCode: exitCode ?? 1 });
    });
  });

  stdoutStream.end();
  stderrStream.end();

  const report = {
    version: '1.0',
    runId,
    stageId: stage.stageId,
    stageLabel: stage.label,
    lane: stage.lane,
    provider: stage.provider,
    mode: options.mode,
    failurePolicy: options.failurePolicy,
    status: stageStatus.type,
    command: stage.command,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    exitCode: stageStatus.exitCode,
    ports: stage.ports,
    composeProjectName: stage.composeProjectName,
    liveExecutionMode: stage.liveExecutionMode,
    coldModeExceptionReason: stage.coldModeExceptionReason,
    logs: stage.logs,
    artifacts: stage.artifacts,
    errorExcerpt:
      stageStatus.type === 'pass'
        ? ''
        : stderrTail.text().trim() || stdoutTail.text().trim() || String(stageStatus.error ?? ''),
  };

  return report;
}

function loadJsonIfExists(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  if (!existsSync(filePath)) return null;

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeExecutedScenarioStatus(status) {
  return ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'].includes(status) ? status : 'UNKNOWN';
}

function newScenarioCounts() {
  return {
    PASS: 0,
    FLAKY: 0,
    FAIL: 0,
    NOT_PASS: 0,
    UNKNOWN: 0,
    NA: 0,
    applicable: 0,
    nonApplicable: 0,
    total: 0,
  };
}

function mapStageStatusBucket(status) {
  if (status === 'infra-fail') return 'infra';
  if (status === 'pass') return 'pass';
  if (status === 'fail') return 'fail';
  if (status === 'skipped') return 'skipped';
  return 'infra';
}

function selectScenarioCell(row, stage) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];

  return (
    cells.find(
      (cell) =>
        cell?.lane === stage.lane &&
        String(cell?.provider ?? 'none') === String(stage.provider ?? 'none'),
    ) ?? null
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function dedupeScenarioDefinitions(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const key = isNonEmptyString(entry.key)
      ? entry.key.trim()
      : isNonEmptyString(entry.id)
        ? entry.id.trim()
        : null;
    if (!key || byKey.has(key)) continue;

    byKey.set(key, {
      id: isNonEmptyString(entry.id) ? entry.id.trim() : key,
      key,
      title: isNonEmptyString(entry.title) ? entry.title.trim() : null,
      planRef: isNonEmptyString(entry.planRef) ? entry.planRef.trim() : null,
    });
  }

  return [...byKey.values()];
}

function scenarioDefinitionsFromLaneResults(laneResultsByStage) {
  const definitions = [];

  for (const laneResults of laneResultsByStage.values()) {
    const scenarioDefinitionsById = new Map(
      (Array.isArray(laneResults?.scenarios) ? laneResults.scenarios : [])
        .filter((entry) => entry && typeof entry.id === 'string')
        .map((entry) => [entry.id, entry]),
    );

    for (const row of Array.isArray(laneResults?.matrix) ? laneResults.matrix : []) {
      const scenarioId = isNonEmptyString(row?.use_case_id) ? row.use_case_id : null;
      const scenarioDefinition = scenarioId ? scenarioDefinitionsById.get(scenarioId) : null;
      definitions.push({
        id: scenarioId ?? (isNonEmptyString(scenarioDefinition?.id) ? scenarioDefinition.id : null),
        key: isNonEmptyString(scenarioDefinition?.key)
          ? scenarioDefinition.key
          : scenarioId ?? 'UNKNOWN',
        title: isNonEmptyString(scenarioDefinition?.title)
          ? scenarioDefinition.title
          : isNonEmptyString(row?.title)
            ? row.title
            : null,
        planRef: isNonEmptyString(scenarioDefinition?.planRef)
          ? scenarioDefinition.planRef
          : isNonEmptyString(row?.plan_section)
            ? row.plan_section
            : null,
      });
    }
  }

  return dedupeScenarioDefinitions(definitions);
}

function loadCanonicalBatchScenarios(summary, laneResultsByStage) {
  if (Array.isArray(summary?.canonicalScenarios) && summary.canonicalScenarios.length > 0) {
    return dedupeScenarioDefinitions(summary.canonicalScenarios);
  }

  const canonicalPath =
    summary?.canonicalTestCasesPath && path.isAbsolute(summary.canonicalTestCasesPath)
      ? summary.canonicalTestCasesPath
      : BATCH_CANONICAL_TEST_CASES_PATH;
  const canonical = loadJsonIfExists(canonicalPath);

  if (Array.isArray(canonical?.scenarios) && canonical.scenarios.length > 0) {
    return dedupeScenarioDefinitions(canonical.scenarios);
  }

  return scenarioDefinitionsFromLaneResults(laneResultsByStage);
}

function latestRunScenarioStatus(laneResults, lane, scenarioKey) {
  const runs = laneResults?.runs?.[lane];
  if (!Array.isArray(runs) || runs.length === 0) return null;

  const sorted = [...runs].sort((left, right) => {
    const leftKey = `${left?.finishedAt ?? ''}|${left?.runId ?? ''}`;
    const rightKey = `${right?.finishedAt ?? ''}|${right?.runId ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });

  let selected = null;
  for (const run of sorted) {
    if (!run || typeof run !== 'object') continue;
    if (!run.scenarios || typeof run.scenarios !== 'object') continue;
    if (!(scenarioKey in run.scenarios)) continue;

    selected = {
      status: normalizeExecutedScenarioStatus(run.scenarios[scenarioKey]),
      runId: isNonEmptyString(run.runId) ? run.runId : null,
      finishedAt: isNonEmptyString(run.finishedAt) ? run.finishedAt : null,
      artifactJsonPath: isNonEmptyString(run.artifactJsonPath) ? run.artifactJsonPath : null,
      artifactMdPath: isNonEmptyString(run.artifactMdPath) ? run.artifactMdPath : null,
    };
  }

  return selected;
}

function latestRunByScenario(runs, scenarioKey) {
  if (!Array.isArray(runs) || runs.length === 0) return null;

  const sorted = [...runs].sort((left, right) => {
    const leftKey = `${left?.finishedAt ?? ''}|${left?.runId ?? ''}`;
    const rightKey = `${right?.finishedAt ?? ''}|${right?.runId ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });

  let selected = null;
  for (const run of sorted) {
    if (!run || typeof run !== 'object') continue;
    if (!run.scenarios || typeof run.scenarios !== 'object') continue;
    if (!(scenarioKey in run.scenarios)) continue;
    selected = run;
  }

  return selected;
}

function normalizeLaneStatus(status) {
  return ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'].includes(status) ? status : 'NOT_PASS';
}

function readCanonicalBatchDefinitions() {
  const canonical = loadJsonIfExists(BATCH_CANONICAL_TEST_CASES_PATH);
  if (!canonical || !Array.isArray(canonical.scenarios) || !Array.isArray(canonical.providers)) {
    throw new Error(
      `Batch canonical test-case definitions missing or invalid at ${BATCH_CANONICAL_TEST_CASES_PATH}`,
    );
  }

  return {
    providers: canonical.providers.filter((provider) => isNonEmptyString(provider)),
    scenarios: canonical.scenarios
      .filter((scenario) => scenario && isNonEmptyString(scenario.key) && isNonEmptyString(scenario.id))
      .map((scenario) => ({
        key: scenario.key.trim(),
        id: scenario.id.trim(),
        title: isNonEmptyString(scenario.title) ? scenario.title.trim() : '',
        planRef: isNonEmptyString(scenario.planRef) ? scenario.planRef.trim() : '',
      })),
  };
}

function integrationEvidenceLinks(run, scenarioKey) {
  if (!run || typeof run !== 'object') return [];

  const auditManifestPath = isNonEmptyString(run.auditManifestPath) ? run.auditManifestPath : null;
  return evidenceLinksFromValues([
    auditManifestPath ? `${auditManifestPath}#scenario=${scenarioKey}` : null,
    ...(Array.isArray(run.integrationEvidenceLinks) ? run.integrationEvidenceLinks : []),
    auditManifestPath,
    isNonEmptyString(run.artifactJsonPath) ? run.artifactJsonPath : null,
    isNonEmptyString(run.artifactMdPath) ? run.artifactMdPath : null,
    isNonEmptyString(run.playwrightReportPath) ? run.playwrightReportPath : null,
  ]);
}

function normalizeLiveCell(liveCell) {
  if (!liveCell || typeof liveCell !== 'object') return { status: 'NOT_PASS' };

  const normalized = { status: normalizeLaneStatus(liveCell.status) };
  for (const key of [
    'runId',
    'artifactJsonPath',
    'artifactMdPath',
    'finishedAt',
    'error',
    'attempts',
    'retryCount',
    'retryReasons',
    'firstFailureRunId',
    'firstFailureArtifactJsonPath',
    'firstFailureArtifactMdPath',
    'firstFailureError',
  ]) {
    if (key in liveCell) {
      normalized[key] = liveCell[key];
    }
  }

  return normalized;
}

function buildResultsSummary(matrix) {
  const totals = { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 };
  const byLane = {
    core: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
    integration: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
    live: { PASS: 0, FLAKY: 0, FAIL: 0, NOT_PASS: 0 },
  };

  let cellCount = 0;
  for (const row of matrix) {
    for (const cell of row.cells) {
      const status = normalizeLaneStatus(cell.status);
      totals[status] += 1;
      byLane[cell.lane][status] += 1;
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

function evidenceNotesFromLiveCell(liveCell) {
  const notes = [];

  if (liveCell.status === 'FLAKY') {
    notes.push('PASS_WITH_RETRY');
  }
  if (isNonEmptyString(liveCell.error)) {
    notes.push(liveCell.error);
  }
  if (typeof liveCell.retryCount === 'number' && liveCell.retryCount > 0) {
    notes.push(`retries=${liveCell.retryCount} attempts=${liveCell.attempts ?? liveCell.retryCount + 1}`);
    for (const reason of Array.isArray(liveCell.retryReasons) ? liveCell.retryReasons : []) {
      notes.push(`retry_reason: ${reason}`);
    }
  }
  if (isNonEmptyString(liveCell.firstFailureRunId)) {
    notes.push(`first_failure_run: ${liveCell.firstFailureRunId}`);
  }
  if (isNonEmptyString(liveCell.firstFailureError)) {
    notes.push(`first_failure_error: ${liveCell.firstFailureError}`);
  }

  return notes;
}

function evidenceLinksFromValues(values) {
  return Array.from(
    new Set(values.filter((value) => isNonEmptyString(value)).map((value) => value.trim())),
  );
}

function cellHasExecutionEvidence(cell) {
  if (!cell || typeof cell !== 'object') return false;

  return (
    (Array.isArray(cell.evidence_links) && cell.evidence_links.some((link) => isNonEmptyString(link))) ||
    (Array.isArray(cell.notes) && cell.notes.some((note) => isNonEmptyString(note)))
  );
}

function liveScenarioEvidence(laneResults, scenarioKey, provider) {
  const liveCell = laneResults?.live_cells?.[scenarioKey]?.[provider];
  if (!liveCell || typeof liveCell !== 'object') {
    return {
      applicable: false,
      status: 'NA',
      artifactJsonPath: null,
      artifactMdPath: null,
      runId: null,
      finishedAt: null,
      evidenceLinks: [],
    };
  }

  const artifactJsonPath = isNonEmptyString(liveCell.artifactJsonPath)
    ? liveCell.artifactJsonPath
    : null;
  const artifactMdPath = isNonEmptyString(liveCell.artifactMdPath) ? liveCell.artifactMdPath : null;
  const runId = isNonEmptyString(liveCell.runId) ? liveCell.runId : null;
  const finishedAt = isNonEmptyString(liveCell.finishedAt) ? liveCell.finishedAt : null;
  const applicable = Boolean(runId || artifactJsonPath || artifactMdPath || finishedAt);

  return {
    applicable,
    status: applicable ? normalizeExecutedScenarioStatus(liveCell.status) : 'NA',
    artifactJsonPath,
    artifactMdPath,
    runId,
    finishedAt,
    evidenceLinks: evidenceLinksFromValues([artifactJsonPath, artifactMdPath]),
  };
}

export function buildBatchResultsReport(summary) {
  const generatedAt = nowIso();
  const canonical = readCanonicalBatchDefinitions();

  const requestedProviders = Array.from(
    new Set(
      (summary?.requestedProviders ?? summary?.providers ?? canonical.providers)
        .map((provider) => String(provider))
        .filter((provider) => provider.length > 0),
    ),
  );
  const providers = canonical.providers.filter((provider) => requestedProviders.includes(provider));

  const stages = Array.isArray(summary?.stages) ? summary.stages : [];
  const coreStage =
    stages.find((stage) => stage?.lane === 'core' && String(stage?.provider ?? 'none') === 'none') ??
    null;
  const integrationStage =
    stages.find(
      (stage) => stage?.lane === 'integration' && String(stage?.provider ?? 'none') === 'none',
    ) ?? null;

  const coreLaneResults = loadJsonIfExists(coreStage?.artifacts?.laneResultsPath);
  const integrationLaneResults = loadJsonIfExists(integrationStage?.artifacts?.laneResultsPath);
  const liveLaneResultsByProvider = new Map(
    providers.map((provider) => {
      const stage =
        stages.find(
          (entry) =>
            entry?.lane === 'live' && String(entry?.provider ?? 'none') === String(provider),
        ) ?? null;
      return [provider, loadJsonIfExists(stage?.artifacts?.laneResultsPath)];
    }),
  );

  const coreRuns = Array.isArray(coreLaneResults?.runs?.core) ? coreLaneResults.runs.core : [];
  const integrationRuns = Array.isArray(integrationLaneResults?.runs?.integration)
    ? integrationLaneResults.runs.integration
    : [];

  const liveCells = {};

  const matrix = canonical.scenarios.map((scenario) => {
    const coreRun = latestRunByScenario(coreRuns, scenario.key);
    const coreStatus = coreRun ? normalizeLaneStatus(coreRun?.scenarios?.[scenario.key]) : 'NOT_PASS';

    const integrationRun = latestRunByScenario(integrationRuns, scenario.key);
    const integrationReportedStatus = integrationRun
      ? normalizeLaneStatus(integrationRun?.scenarios?.[scenario.key])
      : 'NOT_PASS';
    const integrationLinks = integrationEvidenceLinks(integrationRun, scenario.key);
    const integrationStatus =
      integrationReportedStatus === 'PASS' && integrationLinks.length === 0
        ? 'NOT_PASS'
        : integrationReportedStatus;

    liveCells[scenario.key] = {};

    const providerCells = providers.map((provider) => {
      const liveLaneResults = liveLaneResultsByProvider.get(provider);
      const rawLiveCell = liveLaneResults?.live_cells?.[scenario.key]?.[provider];
      const liveCell = normalizeLiveCell(rawLiveCell);
      liveCells[scenario.key][provider] = liveCell;

      const evidenceLinks = evidenceLinksFromValues([
        liveCell.artifactJsonPath,
        liveCell.artifactMdPath,
        liveCell.firstFailureArtifactJsonPath,
        liveCell.firstFailureArtifactMdPath,
      ]);

      return {
        lane: 'live',
        category: 'live',
        provider,
        mode: 'e2e',
        gating: true,
        status: liveCell.status,
        evidence_links: evidenceLinks,
        notes: evidenceNotesFromLiveCell(liveCell),
        generated_at_utc: generatedAt,
      };
    });

    return {
      use_case_id: scenario.id,
      title: scenario.title,
      plan_section: scenario.planRef,
      runtime_scope: 'platform',
      cells: [
        {
          lane: 'core',
          category: 'core',
          provider: 'none',
          mode: 'core',
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
          mode: 'integration',
          gating: true,
          status: integrationStatus,
          evidence_links: integrationLinks,
          notes: [],
          generated_at_utc: generatedAt,
        },
        ...providerCells,
      ],
    };
  });

  return {
    version: '1.0',
    generatedAt,
    generated_at_utc: generatedAt,
    status_enum: ['PASS', 'FLAKY', 'FAIL', 'NOT_PASS'],
    providers,
    scenarios: canonical.scenarios,
    summary: buildResultsSummary(matrix),
    matrix,
    runs: {
      core: [...coreRuns].slice(-50),
      integration: [...integrationRuns]
        .slice(-50)
        .map((run) => ({
          ...run,
          scenarioEvidenceSource: run?.scenarioEvidenceSource ?? null,
          auditManifestPath: run?.auditManifestPath ?? null,
          playwrightReportPath: run?.playwrightReportPath ?? null,
          integrationEvidenceLinks: Array.isArray(run?.integrationEvidenceLinks)
            ? run.integrationEvidenceLinks
            : [],
        })),
    },
    live_cells: liveCells,
  };
}

export function writeBatchResultsReport(summary, reportPath = BATCH_CANONICAL_RESULTS_PATH) {
  const report = buildBatchResultsReport(summary);
  writeJson(reportPath, report);

  return {
    report,
    canonicalPath: reportPath,
  };
}

function summarize(options, runId, reportDir, startedAt, startedMs, stages, results) {
  return {
    version: '1.0',
    runId,
    mode: options.mode,
    failurePolicy: options.failurePolicy,
    providers: options.providers,
    requestedProviders: options.requestedProviders ?? options.providers,
    skippedProviders: options.skippedProviders ?? [],
    dryRun: options.dryRun,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    reportDir,
    stageTotals: {
      total: results.length,
      pass: results.filter((stage) => stage.status === 'pass').length,
      fail: results.filter((stage) => stage.status === 'fail').length,
      infraFail: results.filter((stage) => stage.status === 'infra-fail').length,
      skipped: results.filter((stage) => stage.status === 'skipped').length,
    },
    finalExitCode: results.some((stage) => stage.status === 'infra-fail')
      ? 2
      : results.some((stage) => stage.status === 'fail')
        ? 1
        : 0,
    stages: results.sort(
      (a, b) =>
        stages.findIndex((plan) => plan.stageId === a.stageId) -
        stages.findIndex((plan) => plan.stageId === b.stageId),
    ),
  };
}

export async function runBatch(options, defaults, runId, reportDir, stages) {
  mkdirSync(reportDir, { recursive: true });
  const runManifestPath = path.join(reportDir, 'run-manifest.json');
  writeJson(runManifestPath, {
    version: '1.0',
    runId,
    createdAt: nowIso(),
    options,
    stages,
  });

  ensureBatchPrerequisites(options, reportDir, stages);

  const results = [];

  if (options.dryRun) {
    for (const stage of stages) {
      const report = skippedStageReport(stage, options, runId, 'dry-run');
      writeStageReport(stage, report);
      results.push(report);
    }
  }
  const startedAt = nowIso();
  const startedMs = Date.now();

  if (!options.dryRun && options.mode === 'sequential') {
    for (const stage of stages) {
      const report = stage.skip
        ? skippedStageReport(stage, options, runId, stage.skip.reason)
        : await runStage(stage, options, runId);
      writeStageReport(stage, report);
      results.push(report);
      if (
        options.failurePolicy === 'fail-fast' &&
        (report.status === 'fail' || report.status === 'infra-fail')
      ) {
        break;
      }
    }
  }

  if (!options.dryRun && options.mode === 'parallel') {
    const queue = [...stages];
    const workerCount = Math.max(1, Math.min(options.parallelMax, stages.length));
    const stopState = { stop: false };

    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        if (options.failurePolicy === 'fail-fast' && stopState.stop) return;

        const stage = queue.shift();
        if (!stage) return;

        const report = stage.skip
          ? skippedStageReport(stage, options, runId, stage.skip.reason)
          : await runStage(stage, options, runId);
        writeStageReport(stage, report);
        results.push(report);

        if (
          options.failurePolicy === 'fail-fast' &&
          (report.status === 'fail' || report.status === 'infra-fail')
        ) {
          stopState.stop = true;
        }
      }
    });

    await Promise.all(workers);
  }

  const executedIds = new Set(results.map((entry) => entry.stageId));
  for (const stage of stages) {
    if (executedIds.has(stage.stageId)) continue;
    const skipped = skippedStageReport(
      stage,
      options,
      runId,
      stage.skip?.reason ?? (options.dryRun ? 'dry-run' : 'fail-fast-stop'),
    );
    writeStageReport(stage, skipped);
    results.push(skipped);
  }

  const summary = summarize(options, runId, reportDir, startedAt, startedMs, stages, results);
  const summaryJsonPath = path.join(reportDir, 'summary.json');
  const summaryMarkdownPath = path.join(reportDir, 'summary.md');

  summary.artifacts = {
    runManifestPath,
    summaryJsonPath,
    summaryMarkdownPath,
  };

  const batchReportArtifact = writeBatchResultsReport(
    summary,
    options.batchResultsPath ?? BATCH_CANONICAL_RESULTS_PATH,
  );
  summary.artifacts.batchResultsPath = batchReportArtifact.canonicalPath;

  writeJson(summaryJsonPath, summary);
  writeFileSync(summaryMarkdownPath, summaryMarkdown(summary));

  for (const stage of stages) {
    assertClaimedPathsExist(stage, `Run manifest stage ${stage.stageId}`);
  }
  for (const stage of summary.stages) {
    assertClaimedPathsExist(stage, `Summary stage ${stage.stageId}`);
  }

  for (const requiredPath of [
    runManifestPath,
    summaryJsonPath,
    summaryMarkdownPath,
    batchReportArtifact.canonicalPath,
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Batch evidence artifact missing after write: ${requiredPath}`);
    }
  }

  return summary;
}
