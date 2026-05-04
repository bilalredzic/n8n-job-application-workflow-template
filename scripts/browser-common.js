const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const browserStateDir = path.join(repoRoot, 'browser-state', 'chrome-profile');

const chromeExecutableCandidates = [
  process.env.JOB_CHROME_EXECUTABLE,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const windowsChromeCandidates = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function ensureBrowserStateDir() {
  fs.mkdirSync(browserStateDir, { recursive: true });
}

function getChromeExecutable() {
  const chromeExecutable = chromeExecutableCandidates.find(candidate => fs.existsSync(candidate));

  if (!chromeExecutable) {
    const windowsChromeExecutable = windowsChromeCandidates.find(candidate => fs.existsSync(candidate));
    const wslHint = windowsChromeExecutable
      ? ` Found Windows Chrome at ${windowsChromeExecutable}, but Playwright running inside WSL cannot reliably control the Windows .exe. Install Google Chrome inside WSL, or set JOB_CHROME_EXECUTABLE explicitly if you know this environment supports it.`
      : '';

    throw new Error(
      `Google Chrome/Chromium was not found. Checked: ${chromeExecutableCandidates.join(
        ', ',
      )}.${wslHint} Set JOB_CHROME_EXECUTABLE=/path/to/chrome if it is installed somewhere else.`,
    );
  }

  return chromeExecutable;
}

function getUserAgent(chromeExecutable) {
  if (chromeExecutable.includes('/mnt/c/')) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  if (process.platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
}

function browserLaunchOptions({ headless = true } = {}) {
  ensureBrowserStateDir();
  const executablePath = getChromeExecutable();

  return {
    executablePath,
    headless,
    viewport: { width: 1365, height: 1000 },
    locale: 'en-US',
    userAgent: getUserAgent(executablePath),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };
}

module.exports = {
  browserStateDir,
  browserLaunchOptions,
};
