const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.EDG_BASE_URL || 'http://127.0.0.1:4174/engineering-design-graph/';
const OUT = path.resolve('outputs/engineering-design-graph');
fs.mkdirSync(OUT, { recursive: true });

async function expectText(page, selector, text) {
  await page.locator(selector).filter({ hasText: text }).first().waitFor({ state: 'visible' });
}

async function runViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await expectText(page, '#main h1', 'EC Order Creation');
  assert.equal(await page.locator('#main tbody tr').count(), 8, `${name}: sample artifacts should render`);
  await page.screenshot({ path: path.join(OUT, `${name}-01-overview.png`), fullPage: true });

  // Requirement -> inspector -> stage update.
  await page.locator('#main tbody tr', { hasText: 'REQ-ORDER-001' }).click();
  await expectText(page, '#inspector h2', 'REQ-ORDER-001');
  await page.locator('#title').fill('注文を安全に作成できる');
  await page.locator('#saveArtifact').click();
  await expectText(page, '#main h1', 'ChangeSets');
  await expectText(page, '#main article', '1 item(s)');

  // Preview must compute impact, validation and readiness before apply.
  await page.locator('[data-preview]').first().click();
  await expectText(page, '#changePreview h2', 'Impact preview');
  await expectText(page, '#changePreview', 'impacted');
  await page.screenshot({ path: path.join(OUT, `${name}-02-preview.png`), fullPage: true });

  // Atomic apply -> version increments and staged value becomes visible.
  await page.locator('[data-apply]').first().click();
  await expectText(page, '#main article', 'applied');
  await page.locator('#nav button[data-view="requirement"]').click();
  await expectText(page, '#main tbody', '注文を安全に作成できる');
  await expectText(page, '#main tbody', 'v2');

  // Graph, validation and readiness remain navigable after mutation.
  await page.locator('#nav button[data-view="graph"]').click();
  await expectText(page, '#main h1', 'Traceability Graph');
  assert.ok(await page.locator('#main tbody tr').count() >= 7, `${name}: graph relations should render`);
  await page.locator('#nav button[data-view="validation"]').click();
  await expectText(page, '#main h1', 'Validation');
  await page.locator('#nav button[data-view="readiness"]').click();
  await expectText(page, '#main h1', 'Implementation Readiness');
  assert.match(await page.locator('.readiness strong').innerText(), /READY|NOT_READY/);

  // JSON import exercises persisted project replacement without reloading the app shell.
  await page.locator('#nav button[data-view="overview"]').click();
  const imported = {
    id: 'p-imported', name: 'Imported E2E Project', revision: 1,
    artifacts: [], relations: [], changeSets: [], artifactVersions: []
  };
  await page.locator('#import').setInputFiles({
    name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported))
  });
  await expectText(page, '#main h1', 'Imported E2E Project');
  await page.screenshot({ path: path.join(OUT, `${name}-03-imported.png`), fullPage: true });

  assert.deepEqual(consoleErrors, [], `${name}: browser console/page errors: ${consoleErrors.join('\n')}`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 'desktop', { width: 1440, height: 1000 });
    await runViewport(browser, 'mobile', { width: 390, height: 844 });
    console.log('Engineering Design Graph Playwright E2E: PASS (desktop + mobile)');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
