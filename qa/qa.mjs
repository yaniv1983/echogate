import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = 'C:/Users/yaniv/.cache/puppeteer/chrome/win64-146.0.7680.153/chrome-win64/chrome.exe';
const URL = 'https://echogate.yaniv.tv/';

const logs = [];
const errors = [];

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: CHROME,
  args: [
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-web-security',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

page.on('console', (msg) => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
page.on('requestfailed', (req) => errors.push('REQFAIL: ' + req.url() + ' ' + req.failure()?.errorText));

console.log('Navigating to', URL);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const title = await page.title();
console.log('Title:', title);

// Verify hero heading present
const heroOk = await page.evaluate(() => {
  return !!document.querySelector('h1') && document.body.innerText.includes('EchoGate');
});
console.log('Hero present:', heroOk);

await page.screenshot({ path: 'screenshots/01-landing.png', fullPage: true });

// Upload the fixtures
const fileInput = await page.$('input[type=file]');
if (!fileInput) {
  console.error('No file input found');
  process.exit(2);
}
const fixtures = [
  path.resolve('./fixtures/speaker-a.wav'),
  path.resolve('./fixtures/speaker-b.wav'),
];
console.log('Uploading', fixtures);
await fileInput.uploadFile(...fixtures);

// Wait for "Files Loaded" staging UI
await page.waitForFunction(
  () => document.body.innerText.includes('Files Loaded'),
  { timeout: 30000 },
);
await page.screenshot({ path: 'screenshots/02-staged.png', fullPage: true });

// Click Start Processing
const started = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find((x) => /start processing/i.test(x.innerText || ''));
  if (!b) return false;
  b.click();
  return true;
});
console.log('Start clicked:', started);

// Wait for analysis to finish — look for the Controls Preview Mix or stats
await page.waitForFunction(
  () => document.body.innerText.includes('Preview Mix'),
  { timeout: 60000 },
);
// Give it a moment for the calibration panel etc.
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'screenshots/03-editor.png', fullPage: true });

const panelPresent = await page.evaluate(() =>
  document.body.innerText.includes('Auto Calibration'),
);
console.log('Calibration panel present:', panelPresent);

const hasOverlay = await page.evaluate(() =>
  document.body.innerText.toLowerCase().includes('gate envelope'),
);
console.log('Gate envelope overlay rendered:', hasOverlay);

// Toggle Advanced
const advToggled = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) =>
    /advanced/i.test(x.innerText || ''),
  );
  if (!b) return false;
  b.click();
  return true;
});
console.log('Advanced clicked:', advToggled);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'screenshots/04-advanced.png', fullPage: true });

console.log('Errors count:', errors.length);
errors.slice(0, 20).forEach((e, i) => console.log(`  err#${i}:`, e));

fs.writeFileSync(
  'qa-report.json',
  JSON.stringify(
    { title, heroOk, panelPresent, hasOverlay, errors, logs: logs.slice(0, 100) },
    null,
    2,
  ),
);
await browser.close();
console.log('QA done.');
