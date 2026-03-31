import { expect, test } from '@playwright/test';

import { loginToWorkflows } from './support/workflows-auth.js';
import {
  assertImportedCatalogSelectionMatchesRepo,
  closeCommunityCatalogPool,
  importCatalogPlaybooks,
  loadCatalogSelection,
  resetCommunityCatalogState,
} from './support/community-catalog-fixtures.js';

const SINGLE_PLAYBOOK_ID = 'bug-fix';
const SUBSET_CATEGORY = 'research';

test.beforeEach(async () => {
  await resetCommunityCatalogState();
});

test.afterEach(async () => {
  await resetCommunityCatalogState();
});

test.afterAll(async () => {
  await closeCommunityCatalogPool();
});

test('imports one community playbook and preserves its catalog provenance', async ({ page }) => {
  const selection = await loadCatalogSelection({
    mode: 'single',
    playbookId: SINGLE_PLAYBOOK_ID,
  });

  await loginToWorkflows(page);
  const importResult = await importCatalogPlaybooks(page, selection);
  await assertImportedCatalogSelectionMatchesRepo(selection, importResult);
  await page.goto(`/design/playbooks/${selection.playbooks[0]!.localEntityId}`);
  await expect(
    page.getByText(`Imported from Community Catalog: ${selection.playbooks[0]!.name} v${selection.playbooks[0]!.version}`),
  ).toBeVisible();
});

test('imports a filtered subset of community playbooks from the dashboard', async ({ page }) => {
  const selection = await loadCatalogSelection({
    mode: 'category',
    category: SUBSET_CATEGORY,
  });

  await loginToWorkflows(page);
  const importResult = await importCatalogPlaybooks(page, selection);
  await assertImportedCatalogSelectionMatchesRepo(selection, importResult);
});

test('imports the full community catalog from the dashboard', async ({ page }) => {
  const selection = await loadCatalogSelection({
    mode: 'all',
  });

  await loginToWorkflows(page);
  const importResult = await importCatalogPlaybooks(page, selection);
  await assertImportedCatalogSelectionMatchesRepo(selection, importResult);
});
