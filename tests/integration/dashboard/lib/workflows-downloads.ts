import { expect, type Locator, type Page } from '@playwright/test';

export async function expectPacketFileButton(
  workbench: Locator,
  fileName: string,
): Promise<Locator> {
  const button = workbench.getByRole('button', { name: fileName });
  await expect(button).toBeVisible();
  return button;
}

export async function clickPacketFileAndWaitForResponse(
  page: Page,
  button: Locator,
): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && response.ok()
      && response.url().includes('/input-packets/')
      && response.url().includes('/files/')
      && response.url().endsWith('/content');
  });

  await button.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}
