import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console errors
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  // Collect failed network requests
  const failedRequests: string[] = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  // Login
  await page.goto('http://localhost:3000/login');
  await page.waitForTimeout(2000);
  await page.locator('input').first().fill('ab_admin_def_local_dev_123456789012345');
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Sign in")').click();
  await page.waitForTimeout(4000);

  // Go to execution
  await page.goto('http://localhost:3000/execution');
  await page.waitForTimeout(8000);

  console.log('=== CONSOLE ERRORS ===');
  errors.forEach(e => console.log(e));
  console.log(`\n=== WARNINGS (${warnings.length}) ===`);
  warnings.slice(0, 5).forEach(w => console.log(w));
  console.log(`\n=== FAILED REQUESTS (${failedRequests.length}) ===`);
  failedRequests.forEach(r => console.log(r));

  await browser.close();
}
main();
