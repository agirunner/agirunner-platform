import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test('refreshes the selected work item from targeted workspace activity without another click', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const workItemStreamPattern = new RegExp(
    `/api/v1/operations/workflows/${workflowId}/stream\\?[^#]*work_item_id=${workItemId}(?:&|$)`,
  );
  const workItemDetailPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}(?:\\?.*)?$`,
  );
  const workItemTasksPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks(?:\\?.*)?$`,
  );

  let streamRequestCount = 0;
  let workItemDetailRequestCount = 0;
  let workItemTasksRequestCount = 0;
  let allowRefreshedWorkItemResponses = false;
  let releaseSelectedWorkItemStream: (() => void) | null = null;
  const selectedWorkItemStreamReady = new Promise<void>((resolve) => {
    releaseSelectedWorkItemStream = resolve;
  });

  await page.route(workItemStreamPattern, async (route) => {
    streamRequestCount += 1;
    if (streamRequestCount > 1) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Deterministic test stream is complete.',
          },
        }),
      });
      return;
    }

    await selectedWorkItemStreamReady;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: message',
        `data: ${JSON.stringify({
          cursor: 'cursor-selected-work-item-refresh',
          generated_at: '2026-04-04T19:35:00.000Z',
          latest_event_id: 'event-selected-work-item-refresh',
          snapshot_version: 2,
          events: [
            {
              event_type: 'live_console_append',
              payload: {
                items: [
                  {
                    item_id: 'live-console-selected-work-item-refresh',
                    work_item_id: workItemId,
                    created_at: '2026-04-04T19:35:00.000Z',
                    headline: 'Selected work item received fresh activity',
                  },
                ],
              },
            },
          ],
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.route(workItemDetailPattern, async (route) => {
    workItemDetailRequestCount += 1;
    const response = await route.fetch();
    const payload = await response.json() as {
      data?: Record<string, unknown>;
    };
    if (payload.data && allowRefreshedWorkItemResponses) {
      payload.data = {
        ...payload.data,
        blocked_reason: 'Realtime detail refresh marker',
      };
    }
    await route.fulfill({ response, json: payload });
  });

  await page.route(workItemTasksPattern, async (route) => {
    workItemTasksRequestCount += 1;
    const response = await route.fetch();
    const payload = await response.json() as {
      data?: Array<Record<string, unknown>>;
    };
    if (Array.isArray(payload.data) && allowRefreshedWorkItemResponses) {
      payload.data = [
        {
          id: 'task-realtime-refresh',
          title: 'Draft rollback guidance addendum',
          role: 'developer',
          state: 'in_progress',
        },
        ...payload.data,
      ];
    }
    await route.fulfill({ response, json: payload });
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();

  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('Realtime detail refresh marker.')).toHaveCount(0);
  await expect(workbench.getByText('Draft rollback guidance addendum')).toHaveCount(0);

  allowRefreshedWorkItemResponses = true;
  releaseSelectedWorkItemStream?.();
  await expect(workbench.getByText('Realtime detail refresh marker.').first()).toBeVisible();
  await expect(workbench.getByText('Draft rollback guidance addendum')).toBeVisible();
  await expect.poll(() => workItemDetailRequestCount).toBeGreaterThanOrEqual(2);
  await expect.poll(() => workItemTasksRequestCount).toBeGreaterThanOrEqual(2);
});
