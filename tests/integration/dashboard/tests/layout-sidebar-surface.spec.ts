import { expect, test } from '@playwright/test';

import { loginToWorkflows } from '../lib/workflows-auth.js';

test('keeps desktop navigation groups on a flat sidebar surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await loginToWorkflows(page);

  const expandSidebarButton = page.getByRole('button', { name: 'Expand sidebar' });
  if (await expandSidebarButton.isVisible().catch(() => false)) {
    await expandSidebarButton.click();
  }

  const nav = page.getByLabel('Desktop navigation');
  await expect(nav).toBeVisible();

  const groups = nav.locator('[data-sidebar-section-group="true"]');
  await expect(groups.first()).toBeVisible();

  const surfaces = await groups.evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    }),
  );

  expect(surfaces.length).toBeGreaterThan(0);
  for (const surface of surfaces) {
    expect(surface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(surface.boxShadow).toBe('none');
  }
});
