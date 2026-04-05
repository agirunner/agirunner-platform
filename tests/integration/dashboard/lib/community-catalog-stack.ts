import { mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import {
  COMMUNITY_CATALOG_ADMIN_API_KEY,
  COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT,
  COMMUNITY_CATALOG_DASHBOARD_PORT,
  COMMUNITY_CATALOG_DASHBOARD_URL,
  COMMUNITY_CATALOG_DATABASE_URL,
  COMMUNITY_CATALOG_FIXTURE_BASE_URL,
  COMMUNITY_CATALOG_FIXTURE_REF,
  COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
  COMMUNITY_CATALOG_JWT_SECRET,
  COMMUNITY_CATALOG_PLATFORM_PORT,
  COMMUNITY_CATALOG_PLATFORM_URL,
  COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
  COMMUNITY_CATALOG_POSTGRES_DB,
  COMMUNITY_CATALOG_POSTGRES_IMAGE,
  COMMUNITY_CATALOG_POSTGRES_PASSWORD,
  COMMUNITY_CATALOG_POSTGRES_PORT,
  COMMUNITY_CATALOG_POSTGRES_USER,
  COMMUNITY_CATALOG_WEBHOOK_KEY,
  REPO_ROOT,
} from './community-catalog-stack.constants.js';
import { startDashboardCommunityCatalogFixtureServer } from './community-catalog-fixture-server.js';

const STARTUP_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

async function main(): Promise<void> {
  let fixtureServer:
    | Awaited<ReturnType<typeof startDashboardCommunityCatalogFixtureServer>>
    | undefined;
  let platformApi: ChildProcess | undefined;
  let dashboard: ChildProcess | undefined;

  const cleanup = async () => {
    await stopProcess(dashboard);
    await stopProcess(platformApi);
    await fixtureServer?.stop().catch(() => undefined);
    removeExistingPostgresContainer();
    rmSync(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT, { recursive: true, force: true });
  };

  try {
    mkdirSync(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT, { recursive: true });
    rmSync(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT, { recursive: true, force: true });
    mkdirSync(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT, { recursive: true });

    removeExistingPostgresContainer();
    await startPostgresContainer();
    await waitForPostgresReady();

    fixtureServer = await startDashboardCommunityCatalogFixtureServer();
    platformApi = spawnPlatformApi();
    await waitForHttpReady(`${COMMUNITY_CATALOG_PLATFORM_URL}/health`, 'platform-api');

    dashboard = spawnDashboard();
    await waitForHttpReady(`${COMMUNITY_CATALOG_DASHBOARD_URL}/login`, 'dashboard');
  } catch (error) {
    await cleanup();
    throw error;
  }

  const shutdown = async (code = 0) => {
    await cleanup();
    process.exit(code);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(0);
    });
  }

  platformApi?.once('exit', (code) => {
    if (code !== null && code !== 0) {
      void shutdown(code);
    }
  });
  dashboard?.once('exit', (code) => {
    if (code !== null && code !== 0) {
      void shutdown(code);
    }
  });

  process.stdin.resume();
}

function spawnPlatformApi(): ChildProcess {
  return spawn(
    'corepack',
    ['pnpm', '--dir', `${REPO_ROOT}/apps/platform-api`, 'exec', 'tsx', 'src/index.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(COMMUNITY_CATALOG_PLATFORM_PORT),
        DATABASE_URL: COMMUNITY_CATALOG_DATABASE_URL,
        JWT_SECRET: COMMUNITY_CATALOG_JWT_SECRET,
        WEBHOOK_ENCRYPTION_KEY: COMMUNITY_CATALOG_WEBHOOK_KEY,
        DEFAULT_ADMIN_API_KEY: COMMUNITY_CATALOG_ADMIN_API_KEY,
        CORS_ORIGIN: COMMUNITY_CATALOG_DASHBOARD_URL,
        DASHBOARD_URL: COMMUNITY_CATALOG_DASHBOARD_URL,
        PLATFORM_PUBLIC_BASE_URL: COMMUNITY_CATALOG_PLATFORM_URL,
        ARTIFACT_LOCAL_ROOT: COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT,
        COMMUNITY_CATALOG_REPOSITORY: COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
        COMMUNITY_CATALOG_REF: COMMUNITY_CATALOG_FIXTURE_REF,
        COMMUNITY_CATALOG_RAW_BASE_URL: COMMUNITY_CATALOG_FIXTURE_BASE_URL,
        CONTAINER_MANAGER_CONTROL_URL: 'http://127.0.0.1:9090',
      },
      stdio: 'inherit',
    },
  );
}

function spawnDashboard(): ChildProcess {
  return spawn(
    'corepack',
    [
      'pnpm',
      '--dir',
      `${REPO_ROOT}/apps/dashboard`,
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(COMMUNITY_CATALOG_DASHBOARD_PORT),
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        VITE_PLATFORM_API_URL: COMMUNITY_CATALOG_PLATFORM_URL,
        VITE_DASHBOARD_LOGIN_PREFILL_KEY: COMMUNITY_CATALOG_ADMIN_API_KEY,
      },
      stdio: 'inherit',
    },
  );
}

async function startPostgresContainer(): Promise<void> {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
      '--publish',
      `${COMMUNITY_CATALOG_POSTGRES_PORT}:5432`,
      '--env',
      `POSTGRES_DB=${COMMUNITY_CATALOG_POSTGRES_DB}`,
      '--env',
      `POSTGRES_USER=${COMMUNITY_CATALOG_POSTGRES_USER}`,
      '--env',
      `POSTGRES_PASSWORD=${COMMUNITY_CATALOG_POSTGRES_PASSWORD}`,
      COMMUNITY_CATALOG_POSTGRES_IMAGE,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to start postgres container: ${result.stderr || result.stdout}`);
  }
}

async function waitForPostgresReady(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
        'pg_isready',
        '-U',
        COMMUNITY_CATALOG_POSTGRES_USER,
        '-d',
        COMMUNITY_CATALOG_POSTGRES_DB,
      ],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for community catalog postgres container');
}

function removeExistingPostgresContainer(): void {
  spawnSync('docker', ['rm', '-f', COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
}

async function waitForHttpReady(url: string, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 302 || response.status === 401) {
        return;
      }
    } catch {
      // Keep polling until the process comes up or the timeout expires.
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

async function stopProcess(processToStop: ChildProcess | undefined): Promise<void> {
  if (!processToStop) {
    return;
  }
  if (processToStop.exitCode !== null || processToStop.killed) {
    return;
  }

  processToStop.kill('SIGTERM');
  const exited = await waitForExit(processToStop, 10_000);
  if (exited) {
    return;
  }

  processToStop.kill('SIGKILL');
  await waitForExit(processToStop, 5_000);
}

function waitForExit(processToStop: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveWait) => {
    const timeoutId = setTimeout(() => resolveWait(false), timeoutMs);
    processToStop.once('exit', () => {
      clearTimeout(timeoutId);
      resolveWait(true);
    });
  });
}

main().catch((error) => {
  console.error(error);
  removeExistingPostgresContainer();
  rmSync(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT, { recursive: true, force: true });
  process.exit(1);
});
