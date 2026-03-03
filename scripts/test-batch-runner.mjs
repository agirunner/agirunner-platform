import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
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

export function buildStages(defaults, options, runId, reportDir) {
  const stages = [];
  const stageDefs = defaults.stages;

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

  let dockerIndex = 0;
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

    stage.env = {
      LIVE_ARTIFACTS_ROOT: stage.artifacts.laneArtifactsRoot,
      LIVE_REPORTS_RESULTS_PATH: stage.artifacts.laneResultsPath,
      LIVE_BUILD_CACHE_PATH: path.join(laneRoot, 'compose-build-fingerprint.v1.json'),
      LIVE_TMP_PREFIX: `/tmp/agentbaton-live-${slug(runId)}-${safeStageId}-`,
    };

    if (stage.docker) {
      const offset = dockerIndex;
      dockerIndex += 1;

      const ports = {
        postgres: Number(defaults.ports.postgresBase) + offset,
        platformApi: Number(defaults.ports.platformApiBase) + offset,
        dashboard: Number(defaults.ports.dashboardBase) + offset,
      };

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
        VITE_PLATFORM_API_URL: `http://localhost:${ports.platformApi}`,
      });
    }
  }

  return stages;
}

function writeStageReport(stage, report) {
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

  writeStageReport(stage, report);
  return report;
}

function summarize(options, runId, reportDir, startedAt, startedMs, stages, results) {
  return {
    version: '1.0',
    runId,
    mode: options.mode,
    failurePolicy: options.failurePolicy,
    providers: options.providers,
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
  writeJson(path.join(reportDir, 'run-manifest.json'), {
    version: '1.0',
    runId,
    createdAt: nowIso(),
    options,
    stages,
  });

  if (options.dryRun) {
    for (const stage of stages) {
      writeStageReport(stage, skippedStageReport(stage, options, runId, 'dry-run'));
    }
  }

  const results = [];
  const startedAt = nowIso();
  const startedMs = Date.now();

  if (!options.dryRun && options.mode === 'sequential') {
    for (const stage of stages) {
      const report = await runStage(stage, options, runId);
      results.push(report);
      if (options.failurePolicy === 'fail-fast' && report.status !== 'pass') break;
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

        const report = await runStage(stage, options, runId);
        results.push(report);

        if (options.failurePolicy === 'fail-fast' && report.status !== 'pass') {
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
      options.dryRun ? 'dry-run' : 'fail-fast-stop',
    );
    writeStageReport(stage, skipped);
    results.push(skipped);
  }

  const summary = summarize(options, runId, reportDir, startedAt, startedMs, stages, results);
  writeJson(path.join(reportDir, 'summary.json'), summary);
  writeFileSync(path.join(reportDir, 'summary.md'), summaryMarkdown(summary));
  return summary;
}
