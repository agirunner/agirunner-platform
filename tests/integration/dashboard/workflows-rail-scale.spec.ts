import { expect, test, type Page } from '@playwright/test';

import {
  ADMIN_API_KEY,
  PLATFORM_API_URL,
} from './support/platform-env.js';
import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createWorkflowViaApi,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('keeps the selected workflow stable while the rail grows and reorders', async ({ page }) => {
  const scenario = await seedWorkflowsScenario({ bulkWorkflowCount: 205 });
  const requestedRailPages = new Set<number>();
  const railResponseSummaries: Array<{
    status: number;
    page: number | null;
    lifecycle: string | null;
    rowCount: number;
    ongoingRowCount: number;
    totalCount: number | null;
  }> = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') {
      return;
    }
    const url = new URL(request.url());
    if (url.pathname !== '/api/v1/operations/workflows') {
      return;
    }
    const pageNumber = Number(url.searchParams.get('page') ?? '');
    if (Number.isInteger(pageNumber) && pageNumber > 0) {
      requestedRailPages.add(pageNumber);
    }
  });
  page.on('response', async (response) => {
    if (response.request().method() !== 'GET') {
      return;
    }
    const url = new URL(response.url());
    if (url.pathname !== '/api/v1/operations/workflows') {
      return;
    }
    const pageNumber = Number(url.searchParams.get('page') ?? '');
    const payload = await response.json() as {
      data?: {
        rows?: Array<unknown>;
        ongoing_rows?: Array<unknown>;
        total_count?: number | null;
      };
    };
    railResponseSummaries.push({
      status: response.status(),
      page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null,
      lifecycle: url.searchParams.get('lifecycle'),
      rowCount: payload.data?.rows?.length ?? 0,
      ongoingRowCount: payload.data?.ongoing_rows?.length ?? 0,
      totalCount: payload.data?.total_count ?? null,
    });
  });
  const railResponse = await fetch(
    `${PLATFORM_API_URL}/api/v1/operations/workflows?mode=live&per_page=200`,
    {
      headers: {
        authorization: `Bearer ${ADMIN_API_KEY}`,
      },
    },
  );
  expect(railResponse.ok).toBeTruthy();
  const railPayload = await railResponse.json() as {
    data: {
      rows: Array<{ name: string }>;
      ongoing_rows: Array<{ name: string }>;
    };
  };
  expect(railPayload.data.rows.length + railPayload.data.ongoing_rows.length).toBeGreaterThan(100);
  expect(
    [...railPayload.data.rows, ...railPayload.data.ongoing_rows].some(
      (row) => row.name === 'E2E Bulk Workflow 0104',
    ),
  ).toBeTruthy();
  await loginToWorkflows(page);
  await expect
    .poll(
      () =>
        railResponseSummaries.find((summary) => summary.page === 1)?.rowCount
        ?? railResponseSummaries.find((summary) => summary.page === 1)?.ongoingRowCount
        ?? 0,
      {
        message: `Expected the browser rail request to return data. Seen responses: ${JSON.stringify(railResponseSummaries)}`,
      },
    )
    .toBeGreaterThan(0);

  await revealWorkflowInRail(page, 'E2E Bulk Workflow 0104', requestedRailPages);
  await workflowRailButton(page, 'E2E Bulk Workflow 0104').click();
  await expect(workflowWorkspaceHeading(page, 'E2E Bulk Workflow 0104')).toBeVisible();

  await createWorkflowViaApi({
    name: 'E2E Bulk Workflow Reordered',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    lifecycle: 'planned',
    state: 'completed',
    parameters: {
      workflow_goal: 'Force a fresh workflow into the live rail ordering.',
    },
  });

  await expect(workflowWorkspaceHeading(page, 'E2E Bulk Workflow 0104')).toBeVisible();
});

async function revealWorkflowInRail(
  page: Page,
  workflowName: string,
  requestedRailPages: ReadonlySet<number>,
): Promise<void> {
  const scrollRegion = page.locator('[data-workflows-rail-scroll-region="true"]');
  await expect
    .poll(
      () => page.locator('[data-workflows-rail-scroll-region="true"] button').count(),
      {
        message: 'Expected the workflows rail to render rows before pagination scroll checks.',
      },
    )
    .toBeGreaterThan(10);
  const initialMetrics = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(initialMetrics.scrollHeight).toBeGreaterThan(initialMetrics.clientHeight);
  const scrolledMetrics = await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(scrolledMetrics.scrollTop).toBeGreaterThan(0);

  await expect
    .poll(() => (requestedRailPages.has(2) ? 1 : 0), {
      message: 'Expected rail pagination to request page 2 instead of resetting the first page.',
    })
    .toBe(1);

  await expect
    .poll(async () => {
      const metrics = await scrollRegion.evaluate((element) => ({
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      return metrics.scrollTop > 0 && metrics.scrollHeight > metrics.clientHeight ? 1 : 0;
    }, {
      message: 'Expected rail scroll position to stay away from the top after pagination.',
    })
    .toBe(1);

  await expect
    .poll(async () => {
      await scrollRegion.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      return workflowRailButton(page, workflowName).count();
    }, {
      message: `Expected ${workflowName} to become visible after rail pagination.`,
    })
    .toBeGreaterThan(0);
}

function workflowWorkspaceHeading(page: Page, workflowName: string) {
  return page.locator('h2').filter({ hasText: workflowName }).first();
}
