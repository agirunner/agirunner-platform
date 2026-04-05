import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test('keeps the workflows rail gutter inert away from the centered resize handle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await expect(page.locator('[data-workflows-rail-resize-gutter="true"]')).toBeVisible();

  const metrics = await page.locator('[data-workflows-rail-resize-gutter="true"]').evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const handle = element.querySelector('[data-workflows-rail-resize-handle="true"]');
    if (!(handle instanceof HTMLElement)) {
      return null;
    }

    const gutterRect = element.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const probeY = gutterRect.top + gutterRect.height / 2;
    const edgeProbeX = gutterRect.left + 1;
    const centerProbeX = gutterRect.left + gutterRect.width / 2;
    const hitsHandle = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest('[data-workflows-rail-resize-handle="true"]')
      instanceof HTMLElement;

    return {
      gutterWidth: gutterRect.width,
      handleWidth: handleRect.width,
      edgeHitsHandle: hitsHandle(edgeProbeX, probeY),
      centerHitsHandle: hitsHandle(centerProbeX, probeY),
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics?.gutterWidth ?? 0).toBeGreaterThan(metrics?.handleWidth ?? Number.POSITIVE_INFINITY);
  expect(metrics?.edgeHitsHandle).toBe(false);
  expect(metrics?.centerHitsHandle).toBe(true);
});
