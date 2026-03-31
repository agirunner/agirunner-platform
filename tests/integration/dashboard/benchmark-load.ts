import { performance } from 'node:perf_hooks';

import { chromium } from '@playwright/test';

import {
  ADMIN_API_KEY,
  DASHBOARD_BASE_URL,
  PLATFORM_API_URL,
} from './support/platform-env.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiSamples = await benchmarkRailApi(args.apiRuns, args.perPage);
  const browserSamples = await benchmarkWorkflowPage(args.reloads);

  process.stdout.write(`${JSON.stringify({
    api: {
      per_page: args.perPage,
      runs: apiSamples,
      average_ms: average(apiSamples),
    },
    browser: browserSamples,
  }, null, 2)}\n`);
}

async function benchmarkRailApi(runs: number, perPage: number): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(
      `${PLATFORM_API_URL}/api/v1/operations/workflows?mode=live&per_page=${perPage}`,
      {
        headers: {
          authorization: `Bearer ${ADMIN_API_KEY}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Rail API benchmark failed: ${response.status} ${await response.text()}`);
    }
    await response.json();
    samples.push(roundMs(performance.now() - startedAt));
  }
  return samples;
}

async function benchmarkWorkflowPage(reloads: number): Promise<{
  first_open_ms: number;
  first_workspace_ms: number;
  reload_ms: number[];
}> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ baseURL: DASHBOARD_BASE_URL });
    await login(page);

    const firstOpenMs = await measureWorkflowPageOpen(page);
    const firstWorkspaceMs = await measureWorkspaceOpen(page);
    const reloadMs: number[] = [];

    for (let index = 0; index < reloads; index += 1) {
      const startedAt = performance.now();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-workflows-rail-scroll-region="true"] button').first().waitFor();
      reloadMs.push(roundMs(performance.now() - startedAt));
    }

    return {
      first_open_ms: firstOpenMs,
      first_workspace_ms: firstWorkspaceMs,
      reload_ms: reloadMs,
    };
  } finally {
    await browser.close();
  }
}

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('API Key').fill(ADMIN_API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/workflows/);
  await page.getByRole('heading', { name: 'Workflows' }).waitFor();
}

async function measureWorkflowPageOpen(page: import('@playwright/test').Page): Promise<number> {
  const startedAt = performance.now();
  await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-workflows-rail-scroll-region="true"] button').first().waitFor();
  return roundMs(performance.now() - startedAt);
}

async function measureWorkspaceOpen(page: import('@playwright/test').Page): Promise<number> {
  const startedAt = performance.now();
  await page.locator('main h2').first().waitFor();
  return roundMs(performance.now() - startedAt);
}

function parseArgs(argv: string[]): { apiRuns: number; perPage: number; reloads: number } {
  let apiRuns = 5;
  let perPage = 100;
  let reloads = 3;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--api-runs':
        apiRuns = readPositiveInt(argv[index + 1], apiRuns);
        index += 1;
        break;
      case '--per-page':
        perPage = readPositiveInt(argv[index + 1], perPage);
        index += 1;
        break;
      case '--reloads':
        reloads = readPositiveInt(argv[index + 1], reloads);
        index += 1;
        break;
      default:
        break;
    }
  }
  return { apiRuns, perPage, reloads };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return roundMs(values.reduce((sum, value) => sum + value, 0) / values.length);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
