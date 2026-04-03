import { expect, type Page, test } from '@playwright/test';

import { loginToWorkflows } from '../lib/workflows-auth.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('shows the reported runtime version instead of a moving image tag', async ({ page }) => {
  await routeVersionSummary(page);

  await loginToWorkflows(page);
  await page.getByRole('button', { name: 'Versions' }).click();

  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await expect(popover.getByText('Running Versions')).toBeVisible();
  await expect(popover).toContainText('ghcr.io/agirunner/agirunner-runtime:latest');
  await expect(popover).toContainText('0.1.0-alpha.1');
  await expect(popover).toContainText('2 containers | 1 orchestrator | 1 specialist runtime');
});

async function routeVersionSummary(page: Page): Promise<void> {
  await page.route('**/api/v1/fleet/version-summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          platform_api: buildVersionComponent('agirunner-platform-platform-api', '9.9.1'),
          dashboard: buildVersionComponent('agirunner-platform-dashboard', '9.9.2'),
          container_manager: buildVersionComponent('agirunner/container-manager:latest', '9.9.3'),
          runtimes: [
            {
              image: 'ghcr.io/agirunner/agirunner-runtime:latest',
              image_digest: 'sha256:runtime-version-summary', // pragma: allowlist secret
              version: '0.1.0-alpha.1',
              revision: 'runtime-alpha-1',
              total_containers: 2,
              orchestrator_containers: 1,
              specialist_runtime_containers: 1,
            },
          ],
        },
        meta: {
          request_id: 'layout-version-popover-test',
          timestamp: '2026-04-03T14:00:00.000Z',
        },
      }),
    });
  });
}

function buildVersionComponent(image: string, version: string) {
  return {
    component: image,
    image,
    image_digest: null,
    version,
    revision: 'runtime-validation',
    status: 'Up 1 minute (healthy)',
    started_at: '2026-04-03T14:00:00.000Z',
  };
}
