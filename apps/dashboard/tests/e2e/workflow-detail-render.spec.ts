import { expect, test } from '@playwright/test';

const API = 'http://localhost:8080';
const WORKFLOW_ID = 'workflow-active';

test.beforeEach(async ({ page }) => {
  await page.route(`${API}/api/v1/auth/token`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          token: 'jwt-access-token',
          scope: 'admin',
          tenant_id: 'tenant-1',
        },
      }),
    });
  });

  await page.route(`${API}/api/v1/workflows`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: WORKFLOW_ID,
            name: 'Active Workflow',
            state: 'running',
            created_at: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/workflows/${WORKFLOW_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: WORKFLOW_ID,
          tenant_id: 'tenant-1',
          project_id: null,
          template_id: 'template-1',
          name: 'Active Workflow',
          state: 'running',
          input: {},
          context: { stage: 'execution' },
          metadata: {},
          created_by: 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      }),
    });
  });

  await page.route(`${API}/api/v1/tasks?workflow_id=${WORKFLOW_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'task-1', title: 'Implement thing', state: 'running', depends_on: [] }],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/events`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': connected\n\n',
    });
  });
});

test('renders workflow detail for a valid active workflow id', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('API Key').fill('ar_admin_example_key');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Active Workflow' }).click();

  await expect(page.getByRole('heading', { name: 'Workflow Detail' })).toBeVisible();
  await expect(page.getByText('Active Workflow')).toBeVisible();
  await expect(page.getByText('running').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Implement thing' })).toBeVisible();

  await page.screenshot({
    path: '../../tests/artifacts/integration/screenshots/issue-74-workflow-detail-post-fix.png',
    fullPage: true,
  });
});
