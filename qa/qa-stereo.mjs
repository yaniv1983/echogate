import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = 'C:/Users/yaniv/.cache/puppeteer/chrome/win64-146.0.7680.153/chrome-win64/chrome.exe';
const errors = [];

const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('https://echogate.yaniv.tv/', { waitUntil: 'networkidle0', timeout: 60000 });
const hint = await page.evaluate(() => document.body.innerText);
console.log('Hint shows stereo:', /stereo/i.test(hint));

const input = await page.$('input[type=file]');
await input.uploadFile(path.resolve('./fixtures/stereo-ab.wav'));

await page.waitForFunction(() => document.body.innerText.includes('Files Loaded'), { timeout: 30000 });
const loaded = await page.evaluate(() => document.body.innerText);
console.log('Left slot labelled:', /Left/.test(loaded));
console.log('Right slot labelled:', /Right/.test(loaded));

await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /start processing/i.test(x.innerText));
  b?.click();
});
await page.waitForFunction(() => document.body.innerText.includes('Preview Mix'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: 'screenshots/stereo-editor.png', fullPage: true });
console.log('Calibration panel:', /Auto Calibration/.test(await page.evaluate(() => document.body.innerText)));
console.log('Errors:', errors.length);
errors.forEach(e => console.log(' ', e));
await browser.close();
