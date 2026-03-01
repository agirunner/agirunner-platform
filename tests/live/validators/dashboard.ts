import { chromium } from '@playwright/test';

export async function validateDashboardState(options: {
  dashboardBaseUrl: string;
  screenshotPath: string;
  expectText: string;
}): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const validations: string[] = [];

  try {
    await page.goto(options.dashboardBaseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const content = await page.content();
    if (!content.toLowerCase().includes(options.expectText.toLowerCase())) {
      throw new Error(
        `Dashboard content did not contain expected text: ${options.expectText}`,
      );
    }
    validations.push('dashboard_expected_text_present');

    await page.screenshot({ path: options.screenshotPath, fullPage: true });
    validations.push('dashboard_screenshot_captured');
  } finally {
    await browser.close();
  }

  return validations;
}
