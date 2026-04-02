import { expect, type Page, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('surfaces a real seeded escalation on the workflows page without workspace patching', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await routeStaticWorkflowStream(page, scenario.needsActionWorkflow.id);

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();

  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: /Needs Action/ }).click();

  await expect(workbench.getByText('Resolve escalation', { exact: true })).toBeVisible();
  await expect(workbench.getByText('submit_handoff replay mismatch conflict')).toBeVisible();
  await expect(workbench.getByText('Conflicting request ids', { exact: true })).toBeVisible();
  await expect(
    workbench.getByText(
      'Submitted handoff:seeded-submitted; persisted handoff:seeded-persisted; current attempt handoff:seeded-current-attempt',
    ),
  ).toBeVisible();
  await expect(
    workbench.getByText('Release summary is already persisted for operator review. (handoff:seeded-persisted, full)'),
  ).toBeVisible();
});

async function routeStaticWorkflowStream(page: Page, workflowId: string): Promise<void> {
  await page.route(new RegExp(`/api/v1/operations/workflows/${workflowId}/stream(?:\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': seeded deterministic stream\n\n',
    });
  });
}
