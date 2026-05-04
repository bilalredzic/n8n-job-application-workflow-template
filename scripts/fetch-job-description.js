#!/usr/bin/env node

const { chromium } = require('playwright-core');
const { browserStateDir, browserLaunchOptions } = require('./browser-common');

const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_BROWSER_TIMEOUT_MS || 45000);
const HEADLESS = process.env.JOB_BROWSER_HEADLESS !== 'false';
const MAX_DESCRIPTION_CHARS = Number(process.env.JOB_DESCRIPTION_MAX_CHARS || 6000);

function compact(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(value, max = MAX_DESCRIPTION_CHARS) {
  const text = compact(value);
  return text.length > max ? `${text.slice(0, max).trim()}\n[truncated]` : text;
}

async function clickPossibleExpanders(page) {
  const patterns = [/^show more\b/i, /^see more\b/i, /^read more\b/i];

  for (const pattern of patterns) {
    const locator = page.getByRole('button', { name: pattern });
    const count = Math.min(await locator.count().catch(() => 0), 4);

    for (let index = 0; index < count; index++) {
      const beforeUrl = page.url();
      await locator
        .nth(index)
        .click({ timeout: 1500 })
        .catch(() => {});
      await page.waitForTimeout(250).catch(() => {});

      if (page.url() !== beforeUrl) {
        await page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
      }
    }
  }
}

async function settlePage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  for (let i = 0; i < 5; i++) {
    await clickPossibleExpanders(page);
    const hasAbout = await page.getByText(/about the job/i).count().catch(() => 0);
    if (hasAbout) break;
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.75))).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await clickPossibleExpanders(page);
}

function extractLinkedInFromDom() {
  const stopPatterns = [
    /^show less$/i,
    /^skills$/i,
    /^seniority level$/i,
    /^employment type$/i,
    /^job function$/i,
    /^industries$/i,
    /^referrals increase/i,
    /^similar jobs/i,
    /^people also viewed/i,
    /^recommended jobs/i,
    /^report this job/i,
    /^set alert/i,
    /^meet the hiring team/i,
    /^see who .* has hired/i,
  ];

  const cleanup = value =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const all = [...document.querySelectorAll('main *')];
  const aboutHeading = all.find(element => {
    const text = cleanup(element.innerText || element.textContent || '');
    return /^about the job$/i.test(text) || /^about the role$/i.test(text);
  });

  const selectorCandidates = [
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '[class*="jobs-description"]',
    '[data-test-job-description]',
  ];

  const selectorText = selectorCandidates
    .map(selector => document.querySelector(selector))
    .filter(Boolean)
    .map(element => cleanup(element.innerText || element.textContent || ''))
    .find(text => text.length > 200 && !/^about the job$/i.test(text));

  if (selectorText) {
    return {
      description: selectorText.replace(/^about the job\s*/i, '').trim(),
      source: 'linkedin_description_selector',
    };
  }

  if (!aboutHeading) {
    return { description: '', source: 'linkedin_about_heading_not_found' };
  }

  let best = '';
  let cursor = aboutHeading;

  for (let depth = 0; cursor && depth < 8; depth++) {
    const text = cleanup(cursor.innerText || cursor.textContent || '');
    if (text.length > best.length && text.length < 25000) best = text;
    cursor = cursor.parentElement;
  }

  const lines = cleanup(best)
    .split('\n')
    .map(line => cleanup(line))
    .filter(Boolean);

  const startIndex = lines.findIndex(line => /^about the job$/i.test(line) || /^about the role$/i.test(line));
  const selected = [];

  for (const line of lines.slice(startIndex >= 0 ? startIndex + 1 : 0)) {
    if (stopPatterns.some(pattern => pattern.test(line))) break;
    selected.push(line);
  }

  return {
    description: selected.join('\n'),
    source: selected.length ? 'linkedin_about_section' : 'linkedin_about_empty',
  };
}

function extractGenericFromDom() {
  const cleanup = value =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const jsonLdJob = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(script => script.textContent || '')
    .flatMap(raw => {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    })
    .flatMap(entry => {
      if (Array.isArray(entry?.['@graph'])) return entry['@graph'];
      return [entry];
    })
    .find(entry => /jobposting/i.test(String(entry?.['@type'] || '')));

  if (jsonLdJob) {
    const parts = [
      jsonLdJob.title,
      jsonLdJob.hiringOrganization?.name,
      jsonLdJob.jobLocation?.address?.addressLocality,
      jsonLdJob.jobLocation?.address?.addressRegion,
      jsonLdJob.description,
      jsonLdJob.responsibilities,
      jsonLdJob.qualifications,
      jsonLdJob.skills,
    ];

    return {
      description: cleanup(parts.filter(Boolean).join('\n\n').replace(/<[^>]+>/g, ' ')),
      metaDescription: '',
      source: 'json_ld_job_posting',
    };
  }

  for (const selector of ['script', 'style', 'noscript', 'svg']) {
    document.querySelectorAll(selector).forEach(element => element.remove());
  }

  const main = document.querySelector('main') || document.body;
  const text = cleanup(main?.innerText || document.body.innerText || '');
  const metaDescription =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    '';

  return {
    description: text,
    metaDescription: cleanup(metaDescription),
    source: 'browser_visible_text',
  };
}

function extractJobrightFromDom() {
  const cleanup = value =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const lines = cleanup(document.body.innerText || '')
    .split('\n')
    .map(line => cleanup(line))
    .filter(Boolean);

  const jobClosed = lines.some(line => /^this job has closed\.?$/i.test(line));
  const applySimilarIndex = lines.findIndex(line => /^apply to similar jobs$/i.test(line));
  const startIndex = applySimilarIndex >= 0 ? applySimilarIndex + 1 : Math.max(0, lines.findIndex(line => /^overview$/i.test(line)) + 1);
  const selected = [];

  const skipPatterns = [
    /^sign in$/i,
    /^join now$/i,
    /^overview$/i,
    /^apply to similar jobs$/i,
    /^get referral via linkedin$/i,
    /^free$/i,
    /^your score$/i,
    /^top applicants$/i,
    /^optimize my resume$/i,
    /^draft message to connect$/i,
    /^apply faster with autofill/i,
    /^improve resume match score$/i,
    /^boost your interview chances$/i,
    /^must-have skills for this role$/i,
    /^company data provided by/i,
    /^current stage$/i,
    /^funding$/i,
    /^founded in \d{4}$/i,
    /^\d+(?:-\d+)? employees$/i,
    /^https?:\/\//i,
    /^·\s*/i,
    /^\?$/i,
  ];

  for (const line of lines.slice(startIndex)) {
    if (/^company$/i.test(line) && selected.length > 8) break;
    if (/^boost your interview chances$/i.test(line)) break;
    if (skipPatterns.some(pattern => pattern.test(line))) continue;
    selected.push(line);
  }

  const prefix = jobClosed ? ['This job has closed.'] : [];
  return {
    description: cleanup([...prefix, ...selected].join('\n')),
    metaDescription: '',
    source: 'jobright_job_content',
    jobClosed,
  };
}

function classifyBadPage({ title, description, visibleText, finalUrl }) {
  const text = compact(`${title}\n${description}\n${visibleText.slice(0, 1200)}`);
  const authText = compact(`${title}\n${visibleText.slice(0, 1600)}`);
  const hasJobLikeDescription =
    compact(description).length >= 120 &&
    /\b(job|intern|internship|engineer|developer|data|software|responsibilities|qualifications|requirements|about)\b/i.test(
      description,
    );

  if (/accessdenied|access denied|<Error>|This XML file does not appear to have any style information/i.test(text)) {
    return 'access_denied';
  }

  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|map|xml)(?:$|\?)/i.test(finalUrl)) {
    return 'asset_url';
  }

  if (
    /authwall|checkpoint|captcha|verify you are human|security verification|verifies? you are not a bot|malicious bots|performance and security by cloudflare|ray id:/i.test(
      `${title}\n${visibleText.slice(0, 1000)}`,
    )
  ) {
    return 'blocked_or_login';
  }

  if (
    !hasJobLikeDescription &&
    /authwall|checkpoint|captcha|verify you are human|sign in to view|log in to view|please sign in|please log in/i.test(
      authText,
    )
  ) {
    return 'blocked_or_login';
  }

  if (
    /joinhandshake\.com\/login/i.test(finalUrl) ||
    /^sign in \| handshake$/i.test(title) ||
    /current student .* existing handshake user login|continue with email/i.test(authText)
  ) {
    return 'blocked_or_login';
  }

  return '';
}

async function fetchDescriptionWithContext(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await settlePage(page);

    const title = compact(await page.title().catch(() => ''));
    const visibleText = compact(await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''));
    const hostname = new URL(page.url()).hostname;
    const isLinkedIn = /(^|\.)linkedin\.com$/i.test(hostname);
    const isJobright = /(^|\.)jobright\.ai$/i.test(hostname);
    const extracted = isLinkedIn
      ? await page.evaluate(extractLinkedInFromDom)
      : isJobright
        ? await page.evaluate(extractJobrightFromDom)
        : await page.evaluate(extractGenericFromDom);

    const description = truncate(extracted.description || extracted.metaDescription || '');
    const badPageStatus = classifyBadPage({
      title,
      description,
      visibleText,
      finalUrl: page.url(),
    });
    const status = badPageStatus || (description.length >= 120 ? 'ok' : 'description_not_found');

    return {
      status,
      url,
      final_url: page.url(),
      page_title: title,
      description: status === 'ok' ? description : '',
      description_source: extracted.source,
      job_closed: Boolean(extracted.jobClosed),
      visible_text_excerpt: truncate(visibleText, 800),
      fetched_at: new Date().toISOString(),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function createBrowserSession({ headless = HEADLESS } = {}) {
  const context = await chromium.launchPersistentContext(
    browserStateDir,
    browserLaunchOptions({ headless }),
  );

  return {
    context,
    fetchDescription: url => fetchDescriptionWithContext(context, url),
    close: () => context.close().catch(() => {}),
  };
}

async function fetchDescription(url) {
  const session = await createBrowserSession();

  try {
    return await session.fetchDescription(url);
  } finally {
    await session.close();
  }
}

async function main() {
  const url = process.argv[2];

  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Usage: node scripts/fetch-job-description.js <http(s)-job-url>');
  }

  const result = await fetchDescription(url);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stdout.write(
      `${JSON.stringify({
        status: 'error',
        error: error.message,
        url: process.argv[2] || '',
        fetched_at: new Date().toISOString(),
      })}\n`,
    );
    process.exitCode = 0;
  });
}

module.exports = {
  createBrowserSession,
  fetchDescription,
};
