import { test, expect } from '@playwright/test';

const API = 'http://localhost:8080';

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
            id: 'pipeline-1',
            name: 'Pipeline One',
            state: 'running',
            created_at: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/pipelines/pipeline-1`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { id: 'pipeline-1', name: 'Pipeline One', state: 'running', context: {} },
      }),
    });
  });

  await page.route(`${API}/api/v1/tasks?pipeline_id=pipeline-1`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'task-1', title: 'Implement thing', state: 'ready', depends_on: [] }],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
      }),
    });
  });

  await page.route(`${API}/api/v1/tasks/task-1`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: 'task-1',
          title: 'Implement thing',
          state: 'ready',
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

test('login, view pipeline list, and open task detail', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('API Key').fill('ab_admin_example_key');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const storedTokens = await page.evaluate(() => ({
    accessToken: window.localStorage.getItem('agentbaton.accessToken'),
    refreshToken: window.localStorage.getItem('agentbaton.refreshToken'),
  }));
  expect(storedTokens.accessToken).toBeNull();
  expect(storedTokens.refreshToken).toBeNull();

  await expect(page.getByRole('heading', { name: 'Pipelines' })).toBeVisible();
  await page.getByRole('link', { name: 'Pipeline One' }).click();

  await expect(page.getByRole('heading', { name: 'Pipeline Detail' })).toBeVisible();
  await page.getByRole('link', { name: 'Implement thing' }).click();

  await expect(page.getByRole('heading', { name: 'Task Detail' })).toBeVisible();
});
