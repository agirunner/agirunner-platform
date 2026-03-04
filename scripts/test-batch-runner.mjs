import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

function needsWorkspaceInstall() {
  if (!existsSync(path.join(ROOT, 'node_modules', '.pnpm'))) {
    return true;
  }

  const probe = spawnSync(
    'pnpm',
    ['--filter', '@agentbaton/test-utils', 'exec', 'vitest', '--version'],
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
      command: stageDefs.live.command.map((part) => (part === '__PROVIDER__' ? provider : part)),
    });
  }

  for (const providerRecord of options.skippedProviders ?? []) {
    const provider = providerRecord.provider;
    stages.push({
      stageId: `live-${provider}`,
      lane: 'live',
      provider,
      ...stageDefs.live,
      command: stageDefs.live.command.map((part) => (part === '__PROVIDER__' ? provider : part)),
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
        LIVE_TMP_PREFIX: `/tmp/agentbaton-live-${slug(runId)}-${safeStageId}-`,
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
      const defaultAgentApiUrl = `http://127.0.0.1:${ports.platformApi}/execute`;

      stage.ports = ports;
      stage.composeProjectName = `${slug(defaults.compose.projectPrefix)}-${slug(runId)}-${safeStageId}`;

      Object.assign(stage.env, {
        COMPOSE_PROJECT_NAME: stage.composeProjectName,
        POSTGRES_PORT: String(ports.postgres),
        PLATFORM_API_PORT: String(ports.platformApi),
        DASHBOARD_PORT: String(ports.dashboard),
        LIVE_API_BASE_URL: `http://127.0.0.1:${ports.platformApi}`,
        LIVE_DASHBOARD_BASE_URL: `http://127.0.0.1:${ports.dashboard}`,
        LIVE_POSTGRES_URL: `postgresql://agentbaton:agentbaton@127.0.0.1:${ports.postgres}/agentbaton`,
        VITE_PLATFORM_API_URL: `http://127.0.0.1:${ports.platformApi}`,
        AGENT_API_URL: explicitAgentApiUrl || defaultAgentApiUrl,
        RATE_LIMIT_MAX_PER_MINUTE: process.env.RATE_LIMIT_MAX_PER_MINUTE || '1000',
        LIVE_COMPOSE_MIN_FREE_GB: process.env.LIVE_COMPOSE_MIN_FREE_GB || '3',
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
    logs: stage.logs,
    artifacts: stage.artifacts,
    errorExcerpt:
      stageStatus.type === 'pass'
        ? ''
        : stderrTail.text().trim() || stdoutTail.text().trim() || String(stageStatus.error ?? ''),
  };

  return report;
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

  writeJson(summaryJsonPath, summary);
  writeFileSync(summaryMarkdownPath, summaryMarkdown(summary));

  for (const stage of stages) {
    assertClaimedPathsExist(stage, `Run manifest stage ${stage.stageId}`);
  }
  for (const stage of summary.stages) {
    assertClaimedPathsExist(stage, `Summary stage ${stage.stageId}`);
  }

  for (const requiredPath of [runManifestPath, summaryJsonPath, summaryMarkdownPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Batch evidence artifact missing after write: ${requiredPath}`);
    }
  }

  return summary;
}
