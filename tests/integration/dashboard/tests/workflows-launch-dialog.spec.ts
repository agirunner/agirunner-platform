import { Buffer } from 'node:buffer';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginToWorkflows } from '../lib/workflows-auth.js';
import {
  listWorkflowInputPackets,
  listWorkflows,
  seedLaunchDialogScenario,
} from '../lib/workflows-fixtures.js';

test('keeps launch selector options populated on every open', async ({ page }) => {
  await seedLaunchDialogScenario();
  await loginToWorkflows(page);

  await page.locator('aside').getByRole('button', { name: 'New Workflow' }).click();
  await expect(page.getByRole('heading', { name: 'New workflow' })).toBeVisible();

  const playbookTrigger = page.locator('label').filter({ hasText: 'Playbook' }).getByRole('button');
  const workspaceTrigger = page.locator('label').filter({ hasText: 'Workspace' }).getByRole('button');

  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);

  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
});

test('creates a workflow with launch attachments and persists the uploaded file', async ({ page }) => {
  const scenario = await seedLaunchDialogScenario({ playbookCount: 2, workspaceCount: 2 });
  const workflowName = `E2E Launch Upload ${Date.now().toString(36)}`;
  await loginToWorkflows(page);

  await page.locator('aside').getByRole('button', { name: 'New Workflow' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'New workflow' })).toBeVisible();

  await chooseComboboxOption(
    page,
    dialog.locator('label').filter({ hasText: 'Playbook' }).getByRole('button'),
    scenario.playbooks[0].name ?? '',
  );
  await chooseComboboxOption(
    page,
    dialog.locator('label').filter({ hasText: 'Workspace' }).getByRole('button'),
    scenario.workspaces[0].name ?? '',
  );
  await dialog.getByLabel('Workflow name').fill(workflowName);
  await dialog.getByLabel('Workflow Goal').fill('Validate launch-time attachment handling through Mission Control.');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'launch-proof.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Launch proof\nThis file was attached during workflow creation.\n', 'utf8'),
  });
  await expect(dialog.getByText('launch-proof.md')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create workflow' }).click();

  await expect(page.getByText('Workflow created')).toBeVisible();
  let workflowId: string | null = null;
  await expect
    .poll(async () => {
      const workflows = await listWorkflows() as Array<{ id?: string; name?: string }>;
      workflowId = workflows.find((workflow) => workflow.name === workflowName)?.id ?? null;
      return workflowId;
    })
    .not.toBeNull();

  const packets = await listWorkflowInputPackets(String(workflowId)) as Array<{
    summary?: string | null;
    files?: Array<{ file_name?: string | null }>;
  }>;
  expect(
    packets.some(
      (packet) =>
        packet.summary === 'Workflow launch files'
        && (packet.files ?? []).some((file) => file.file_name === 'launch-proof.md'),
    ),
  ).toBeTruthy();

  await page.locator('aside').getByRole('button', { name: workflowName }).click();
  await expect(page.locator('[data-workflows-workbench-frame="true"]').getByRole('link', { name: 'launch-proof.md' })).toBeVisible();
});

async function expectLaunchSelectorOptions(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(page.getByText('No results found')).toHaveCount(0);
  await expect
    .poll(async () => page.getByRole('option').count(), {
      message: 'Expected launch selector to show at least one option.',
    })
    .toBeGreaterThan(0);
  await trigger.click();
  await expect(listbox).toBeHidden();
}

async function chooseComboboxOption(
  page: Page,
  trigger: Locator,
  optionName: string,
): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name: optionName }).click();
}
