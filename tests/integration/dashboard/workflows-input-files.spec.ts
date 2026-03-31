import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createSeededWorkflowInputPacket,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('shows scope-pure workflow and work-item input files in Details', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await createSeededWorkflowInputPacket({
    workflowId: scenario.ongoingWorkflow.id,
    packetKind: 'launch_inputs',
    summary: 'Workflow launch files',
    structuredInputs: {
      release: '2026.03',
    },
    files: [
      {
        fileName: 'launch-summary.pdf',
        content: 'workflow launch summary',
        contentType: 'application/pdf',
      },
    ],
  });
  await createSeededWorkflowInputPacket({
    workflowId: scenario.ongoingWorkflow.id,
    workItemId: scenario.ongoingWorkItem.id,
    packetKind: 'rollback_plan',
    summary: 'Rollback guide',
    structuredInputs: {
      path: 'docs/rollback.md',
    },
    files: [
      {
        fileName: 'rollback.md',
        content: '# Rollback\nUse the safe rollback checklist.\n',
        contentType: 'text/markdown',
      },
    ],
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Ongoing Intake').click();

  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  const workflowFileLink = workbench.getByRole('link', { name: 'launch-summary.pdf' });
  const workItemFileLink = workbench.getByRole('link', { name: 'rollback.md' });

  await expect(workbench.getByText('What exists now')).toBeVisible();
  await expect(workflowFileLink).toBeVisible();
  await expect(workItemFileLink).toHaveCount(0);
  await expect(workflowFileLink).toHaveAttribute('href', /\/input-packets\/.+\/files\/.+\/content$/);

  await page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Triage intake queue' })
    .first()
    .click();

  await expect(page).toHaveURL(/work_item_id=/);
  await expect(workbench.getByText('Work item · Triage intake queue')).toBeVisible();
  await expect(workItemFileLink).toBeVisible();
  await expect(workItemFileLink).toHaveAttribute('href', /\/input-packets\/.+\/files\/.+\/content$/);
  await expect(workflowFileLink).toHaveCount(0);
});
