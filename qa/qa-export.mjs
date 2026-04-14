import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = 'C:/Users/yaniv/.cache/puppeteer/chrome/win64-146.0.7680.153/chrome-win64/chrome.exe';
const errors = [];
const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('https://echogate.yaniv.tv/', { waitUntil: 'networkidle0', timeout: 60000 });
const input = await page.$('input[type=file]');
await input.uploadFile(
  path.resolve('./fixtures/speaker-a.wav'),
  path.resolve('./fixtures/speaker-b.wav'),
);
await page.waitForFunction(() => document.body.innerText.includes('Files Loaded'), { timeout: 30000 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /start processing/i.test(x.innerText));
  b?.click();
});
await page.waitForFunction(() => document.body.innerText.includes('Preview Mix'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));

// Open Export menu
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^Export$/.test(x.innerText.trim()));
  b?.click();
});
await new Promise(r => setTimeout(r, 400));

const menu = await page.evaluate(() => document.body.innerText);
const checks = {
  'Auto-Level (-14 LUFS, broadcast)': /-14 LUFS/.test(menu),
  'Neural Denoise (RNNoise)':          /Neural Denoise/.test(menu),
  'Truncate Silences':                 /Truncate Silences/.test(menu),
  'Detect Fillers':                    /Detect Fillers/.test(menu),
  'Speaker 1 PROCESSED':               /Speaker 1 PROCESSED/.test(menu),
};
for (const [k, v] of Object.entries(checks)) console.log(v ? '[OK]' : '[XX]', k);

await page.screenshot({ path: 'screenshots/export-menu.png', fullPage: true });
console.log('Errors:', errors.length);
errors.forEach(e => console.log(' ', e));
await browser.close();
