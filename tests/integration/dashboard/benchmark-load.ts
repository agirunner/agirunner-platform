import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import { ADMIN_API_KEY, DASHBOARD_BASE_URL, PLATFORM_API_URL } from './support/platform-env.js';
import {
  assertSeededScenarioIsInert,
  settleFixtureWorkflowActivations,
} from './support/workflows-validation.js';
import {
  parseSeedLoadArgs,
  seedWorkflowLoadCorpus,
  type SeedLoadArgs,
  type SeedLoadResult,
} from './seed-load.js';

export interface BenchmarkLoadArgs extends SeedLoadArgs {
  reloads: number;
  skipSeed: boolean;
}

interface RailApiRow {
  workflow_id: string;
  name: string;
}

interface WorkflowRailResponse {
  data?: {
    rows?: RailApiRow[];
    ongoing_rows?: RailApiRow[];
  };
}

interface LoginResponse {
  data?: {
    token?: string;
    tenant_id?: string;
  };
}

export function parseBenchmarkLoadArgs(argv: string[]): BenchmarkLoadArgs {
  const baseArgs = parseSeedLoadArgs(argv);
  let reloads = 3;
  let skipSeed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--reloads':
        reloads = readPositiveInt(argv[index + 1], reloads);
        index += 1;
        break;
      case '--skip-seed':
        skipSeed = true;
        break;
      default:
        break;
    }
  }

  return {
    ...baseArgs,
    reloads,
    skipSeed,
  };
}

async function main(): Promise<void> {
  const args = parseBenchmarkLoadArgs(process.argv.slice(2));
  await settleFixtureWorkflowActivations();
  assertSeededScenarioIsInert();

  const seedResult = args.skipSeed ? null : await seedWorkflowLoadCorpus(args);
  await settleFixtureWorkflowActivations();
  assertSeededScenarioIsInert();

  const railApi = await measureRailApi();
  const selectedRow = pickSelectedRailRow(railApi.payload);
  const workspaceApi = selectedRow
    ? await measureWorkspaceApi(selectedRow.workflow_id)
    : null;
  const browser = selectedRow
    ? await measureBrowser(selectedRow.name, args.reloads)
    : null;

  await settleFixtureWorkflowActivations();
  assertSeededScenarioIsInert();

  process.stdout.write(`${JSON.stringify({
    seed: seedResult,
    api: {
      rail_first_page_ms: railApi.durationMs,
      workspace_ms: workspaceApi?.durationMs ?? null,
      selected_workflow_id: selectedRow?.workflow_id ?? null,
      selected_workflow_name: selectedRow?.name ?? null,
    },
    browser,
  }, null, 2)}\n`);
}

async function measureRailApi(): Promise<{
  durationMs: number;
  payload: WorkflowRailResponse;
}> {
  const startedAt = performance.now();
  const response = await fetch(`${PLATFORM_API_URL}/api/v1/operations/workflows?mode=live&page=1&per_page=100`, {
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Rail benchmark request failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as WorkflowRailResponse;
  return {
    durationMs: roundDuration(performance.now() - startedAt),
    payload,
  };
}

async function measureWorkspaceApi(workflowId: string): Promise<{ durationMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(
    `${PLATFORM_API_URL}/api/v1/operations/workflows/${workflowId}/workspace?tab_scope=workflow&board_mode=active_recent_complete`,
    {
      headers: {
        authorization: `Bearer ${ADMIN_API_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Workspace benchmark request failed for ${workflowId}: ${response.status} ${await response.text()}`);
  }
  await response.json();
  return { durationMs: roundDuration(performance.now() - startedAt) };
}

async function measureBrowser(
  workflowName: string,
  reloads: number,
): Promise<{
  first_open_ms: number;
  select_workflow_ms: number;
  selected_workflow_name: string;
  reloads_ms: number[];
}> {
  const browser = await chromium.launch({ headless: true });
  const auth = await loginForBenchmark();
  const context = await browser.newContext();
  await context.addInitScript(({ token, tenantId }) => {
    window.sessionStorage.setItem('agirunner.accessToken', token);
    window.sessionStorage.setItem('agirunner.tenantId', tenantId);
  }, {
    token: auth.token,
    tenantId: auth.tenantId,
  });
  const page = await context.newPage();

  try {
    const openStartedAt = performance.now();
    await page.goto(`${DASHBOARD_BASE_URL}/workflows`);
    await page.waitForURL(/\/workflows/);
    await page.getByRole('heading', { name: 'Workflows' }).waitFor({ state: 'visible' });
    const railButtons = page.locator('[data-workflows-rail-scroll-region="true"] button');
    await railButtons.first().waitFor({ state: 'visible' });
    const firstOpenMs = roundDuration(performance.now() - openStartedAt);

    let targetButton = railButtons.filter({ hasText: workflowName }).first();
    if (await targetButton.count() === 0) {
      targetButton = railButtons.first();
    }
    const selectedWorkflowName = (await targetButton.locator('p').first().textContent())?.trim() || workflowName;
    const selectStartedAt = performance.now();
    await targetButton.click();
    await page.locator('h2').filter({ hasText: selectedWorkflowName }).first().waitFor({ state: 'visible' });
    const selectWorkflowMs = roundDuration(performance.now() - selectStartedAt);

    const reloadsMs: number[] = [];
    for (let index = 0; index < reloads; index += 1) {
      const reloadStartedAt = performance.now();
      await page.reload();
      await page.locator('aside button').first().waitFor({ state: 'visible' });
      reloadsMs.push(roundDuration(performance.now() - reloadStartedAt));
    }

    return {
      first_open_ms: firstOpenMs,
      select_workflow_ms: selectWorkflowMs,
      selected_workflow_name: selectedWorkflowName,
      reloads_ms: reloadsMs,
    };
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

async function loginForBenchmark(): Promise<{ token: string; tenantId: string }> {
  const response = await fetch(`${PLATFORM_API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      api_key: ADMIN_API_KEY,
      persistent_session: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Benchmark login failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as LoginResponse;
  const token = payload.data?.token?.trim() ?? '';
  const tenantId = payload.data?.tenant_id?.trim() ?? '';
  if (!token || !tenantId) {
    throw new Error('Benchmark login did not return a usable token and tenant id.');
  }
  return { token, tenantId };
}

function pickSelectedRailRow(payload: WorkflowRailResponse): RailApiRow | null {
  return payload.data?.ongoing_rows?.[0] ?? payload.data?.rows?.[0] ?? null;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function roundDuration(value: number): number {
  return Number(value.toFixed(1));
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
