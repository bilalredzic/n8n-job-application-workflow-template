#!/usr/bin/env node

const readline = require('readline');
const { chromium } = require('playwright-core');
const { browserStateDir, browserLaunchOptions } = require('./browser-common');

async function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise(resolve => {
    rl.question(
      '\nLog into the job site in the opened Chrome window, then press Enter here to save the browser session. ',
      resolve,
    );
  });
  rl.close();
}

(async () => {
  const startUrl = process.argv[2] || 'https://www.linkedin.com/jobs/';
  const context = await chromium.launchPersistentContext(
    browserStateDir,
    browserLaunchOptions({ headless: false }),
  );

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(startUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await waitForEnter();
  await context.close();
  console.log(JSON.stringify({ status: 'ok', browserStateDir }));
})().catch(error => {
  console.error(JSON.stringify({ status: 'error', error: error.message }));
  process.exit(1);
});
