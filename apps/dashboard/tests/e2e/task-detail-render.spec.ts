import { expect, test } from '@playwright/test';

const API = 'http://localhost:8080';
const PIPELINE_ID = 'pipeline-1';
const TASK_ID = 'task-1';

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

  await page.route(`${API}/api/v1/pipelines`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: PIPELINE_ID,
            name: 'Pipeline One',
            state: 'running',
            created_at: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/pipelines/${PIPELINE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: PIPELINE_ID,
          tenant_id: 'tenant-1',
          project_id: null,
          template_id: 'template-1',
          name: 'Pipeline One',
          state: 'running',
          input: {},
          context: {},
          metadata: {},
          created_by: 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      }),
    });
  });

  await page.route(`${API}/api/v1/tasks?pipeline_id=${PIPELINE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: TASK_ID, title: 'Implement thing', state: 'ready', depends_on: [] }],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/tasks/${TASK_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: TASK_ID,
          tenant_id: 'tenant-1',
          pipeline_id: PIPELINE_ID,
          title: 'Implement thing',
          state: 'ready',
          capabilities_required: ['llm-api', 'role:developer'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
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

  await page.route(`${API}/api/v1/workers`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route(`${API}/api/v1/agents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route(`${API}/metrics`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: '# HELP test metric\ntest_metric 1',
    });
  });
});

test('renders task detail payload for a valid task id', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('API Key').fill('ab_admin_example_key');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Pipeline One' }).click();
  await page.getByRole('link', { name: 'Implement thing' }).click();

  await expect(page.getByRole('heading', { name: 'Task Detail' })).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Built-in worker can handle this task' }),
  ).toBeVisible();
  await expect(page.locator('pre')).toContainText('"title": "Implement thing"');
});
