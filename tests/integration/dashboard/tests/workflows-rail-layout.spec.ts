import { expect, test } from '@playwright/test';

import { loginToWorkflows } from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('keeps empty workflow rail background out of workflow card hit targets', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);
  await page.getByPlaceholder('Search workflows').fill('E2E Planned Terminal Brief');

  const railScrollRegion = page.locator('[data-workflows-rail-scroll-region="true"]');
  await expect(railScrollRegion).toBeVisible();
  await expect(railScrollRegion.getByRole('button')).toHaveCount(1);

  const railLayout = await railScrollRegion.evaluate((region) => {
    const workflowButtons = Array.from(region.querySelectorAll('button'));
    const lastButton = workflowButtons.at(-1);
    const railRect = region.getBoundingClientRect();
    const lastButtonRect = lastButton?.getBoundingClientRect();

    if (!lastButtonRect || workflowButtons.length === 0) {
      throw new Error('Expected workflow rail to contain at least one workflow button.');
    }

    const emptyBackgroundHeight = railRect.bottom - lastButtonRect.bottom;
    const probePoint = {
      x: railRect.left + railRect.width / 2,
      y: lastButtonRect.bottom + Math.max(12, emptyBackgroundHeight / 2),
    };
    const hitElement = document.elementFromPoint(probePoint.x, probePoint.y);
    const hitWorkflowButton = hitElement?.closest('[data-workflows-rail-scroll-region="true"] button');

    return {
      workflowButtonCount: workflowButtons.length,
      emptyBackgroundHeight,
      hitWorkflowButton: Boolean(hitWorkflowButton),
    };
  });

  expect(railLayout.workflowButtonCount).toBeGreaterThan(0);
  expect(railLayout.emptyBackgroundHeight).toBeGreaterThan(40);
  expect(railLayout.hitWorkflowButton).toBe(false);
});
