#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createBrowserSession } = require('./fetch-job-description');

const HOST = process.env.JOB_FETCH_HOST || '127.0.0.1';
const PORT = Number(process.env.JOB_FETCH_PORT || 3456);
const PROFILE_PATH = process.env.JOB_PROFILE_PATH || path.resolve(__dirname, '..', 'profile.md');
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.JOB_FETCH_CONCURRENCY || 4));
const DEFAULT_HOST_CONCURRENCY = Math.max(1, Number(process.env.JOB_FETCH_DEFAULT_HOST_CONCURRENCY || 1));
const SAME_HOST_DELAY_MS = Math.max(0, Number(process.env.JOB_FETCH_SAME_HOST_DELAY_MS || 1500));
const HOST_CONCURRENCY = {
  'glassdoor.com': Math.max(1, Number(process.env.JOB_FETCH_GLASSDOOR_CONCURRENCY || 1)),
  ...Object.fromEntries(
    String(process.env.JOB_FETCH_HOST_CONCURRENCY || '')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => {
        const [host, value] = entry.split(':');
        return [host.toLowerCase().replace(/^www\./, ''), Math.max(1, Number(value || 1))];
      }),
  ),
};

const pendingFetches = [];
const hostLastStartedAt = new Map();
const activeHostCounts = new Map();
let activeFetches = 0;
let browserSessionPromise = null;

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runLimited(hostname, task) {
  return new Promise((resolve, reject) => {
    pendingFetches.push({
      hostname,
      task,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    });
    drainFetchQueue();
  });
}

function drainFetchQueue() {
  while (activeFetches < FETCH_CONCURRENCY && pendingFetches.length > 0) {
    const jobIndex = pendingFetches.findIndex(candidate => activeCountFor(candidate.hostname) < hostLimitFor(candidate.hostname));
    if (jobIndex === -1) return;

    const [job] = pendingFetches.splice(jobIndex, 1);
    activeFetches += 1;
    setActiveCount(job.hostname, activeCountFor(job.hostname) + 1);
    Promise.resolve()
      .then(async () => {
        const queueWaitMs = Date.now() - job.enqueuedAt;
        const lastStartedAt = hostLastStartedAt.get(job.hostname) || 0;
        const waitMs = Math.max(0, SAME_HOST_DELAY_MS - (Date.now() - lastStartedAt));
        if (waitMs > 0) await sleep(waitMs);
        hostLastStartedAt.set(job.hostname, Date.now());
        const value = await job.task();
        job.resolve({ value, queueWaitMs });
      })
      .catch(job.reject)
      .finally(() => {
        activeFetches -= 1;
        setActiveCount(job.hostname, activeCountFor(job.hostname) - 1);
        drainFetchQueue();
      });
  }
}

function hostLimitFor(hostname) {
  return HOST_CONCURRENCY[hostname] || DEFAULT_HOST_CONCURRENCY;
}

function activeCountFor(hostname) {
  return activeHostCounts.get(hostname) || 0;
}

function setActiveCount(hostname, count) {
  if (count > 0) {
    activeHostCounts.set(hostname, count);
  } else {
    activeHostCounts.delete(hostname);
  }
}

function hostnameFor(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function pendingFetchesByHost() {
  return pendingFetches.reduce((counts, job) => {
    counts[job.hostname] = (counts[job.hostname] || 0) + 1;
    return counts;
  }, {});
}

function activeFetchesByHost() {
  return Object.fromEntries(activeHostCounts.entries());
}

async function getBrowserSession() {
  if (!browserSessionPromise) {
    browserSessionPromise = createBrowserSession().catch(error => {
      browserSessionPromise = null;
      throw error;
    });
  }

  return browserSessionPromise;
}

async function resetBrowserSession() {
  const session = await browserSessionPromise?.catch(() => null);
  browserSessionPromise = null;
  if (session) await session.close();
}

async function fetchWithSharedBrowser(url) {
  let session = await getBrowserSession();

  try {
    return await session.fetchDescription(url);
  } catch (error) {
    if (/target.*closed|browser.*closed|context.*closed|has been closed/i.test(error.message)) {
      await resetBrowserSession();
      session = await getBrowserSession();
      return session.fetchDescription(url);
    }

    throw error;
  }
}

function readProfileConfig() {
  try {
    return {
      profile_config: fs.readFileSync(PROFILE_PATH, 'utf8').trim(),
      profile_path: PROFILE_PATH,
      profile_status: 'ok',
    };
  } catch (error) {
    return {
      profile_config: '',
      profile_path: PROFILE_PATH,
      profile_status: 'error',
      profile_error: error.message,
    };
  }
}

function withProfileConfig(body) {
  return {
    ...body,
    ...readProfileConfig(),
  };
}

function withProfile(body, profile) {
  return {
    ...body,
    ...profile,
  };
}

function withRequestMetadata(body, metadata) {
  return {
    ...metadata,
    ...body,
  };
}

function parseMaybeJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isAssetOrUtilityUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const full = `${host}${path}`;

    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|map|xml)(?:$|\?)/i.test(path)) return true;
    if (/^(static|media|images?|img|assets)\./i.test(host)) return true;
    if (/\/(static|assets|images?|img|logos?|icons?|favicon|pixel|tracking|unsubscribe|privacy|legal|help|settings|promo|premium|widget)\b/i.test(path)) return true;
    if (/unsubscribe|manage[_-]?alerts?|emailpreference|privacy|legal|help|settings|promo|premium|widget|tracking|pixel|logo|favicon/i.test(full)) return true;
  } catch {
    return true;
  }

  return false;
}

async function getFetchRequest(req) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const queryUrl = requestUrl.searchParams.get('url') || '';
  const queryMetadata = {
    job_key: requestUrl.searchParams.get('job_key') || '',
    browser_fetch_index: requestUrl.searchParams.get('browser_fetch_index') || '',
    browser_fetch_source: requestUrl.searchParams.get('source') || '',
  };
  if (queryUrl) return { url: queryUrl, metadata: queryMetadata };

  if (req.method === 'POST') {
    const rawBody = await getRequestBody(req);
    if (!rawBody.trim()) return { url: '', metadata: queryMetadata };
    const parsed = JSON.parse(rawBody);
    return {
      url: parsed.url || '',
      metadata: {
        job_key: parsed.job_key || queryMetadata.job_key,
        browser_fetch_index: parsed.browser_fetch_index ?? queryMetadata.browser_fetch_index,
        browser_fetch_source: parsed.source || queryMetadata.browser_fetch_source,
      },
    };
  }

  return { url: '', metadata: queryMetadata };
}

async function getBatchFetchRequest(req, requestUrl) {
  const querySource = requestUrl.searchParams.get('source') || '';
  if (req.method !== 'POST') {
    return {
      source: querySource,
      jobs: [],
    };
  }

  const rawBody = await getRequestBody(req);
  const parsedBody = parseMaybeJson(parseMaybeJson(rawBody, {}), {});
  const source = Array.isArray(parsedBody) ? querySource : parsedBody.source || parsedBody.batch_source || querySource;
  const rawJobs = Array.isArray(parsedBody)
    ? parsedBody
    : parseMaybeJson(parsedBody.jobs ?? parsedBody.items ?? [], []);
  const jobs = Array.isArray(rawJobs) ? rawJobs : [];

  return {
    source,
    jobs,
  };
}

function jobFetchRequestFromBatchJob(job, batchSource, index) {
  const json = job && typeof job === 'object' && job.json ? job.json : job;
  const source = String(json?.source || batchSource || '').toLowerCase();
  const hasExplicitFetchUrl = Object.prototype.hasOwnProperty.call(json || {}, 'browser_fetch_url');
  const url = String(hasExplicitFetchUrl ? json.browser_fetch_url || '' : json?.url || '').trim();

  return {
    url,
    metadata: {
      job_key: json?.job_key || '',
      browser_fetch_index: json?.browser_fetch_index ?? index,
      browser_fetch_source: source,
    },
  };
}

async function fetchRequest({ url, metadata, includeProfile = true }) {
  try {
    const finalize = body => (
      includeProfile
        ? withProfileConfig(withRequestMetadata(body, metadata))
        : withRequestMetadata(body, metadata)
    );

    if (!/^https?:\/\//i.test(url)) {
      return finalize({
        status: 'no_url',
        error: 'Missing or invalid url. Browser fetch skipped.',
        fetched_at: new Date().toISOString(),
      });
    }

    if (isAssetOrUtilityUrl(url)) {
      return finalize({
        status: 'asset_url',
        url,
        error: 'URL points to an asset or utility page. Browser fetch skipped.',
        fetched_at: new Date().toISOString(),
      });
    }

    const startedAt = Date.now();
    const hostname = hostnameFor(url);
    const { value: result, queueWaitMs } = await runLimited(hostname, () => fetchWithSharedBrowser(url));

    return finalize({
      ...result,
      queued_ms: queueWaitMs,
      total_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const errorBody = withRequestMetadata({
      status: 'error',
      error: error.message,
      fetched_at: new Date().toISOString(),
    }, metadata);

    return includeProfile ? withProfileConfig(errorBody) : errorBody;
  }
}

const server = http.createServer(async (req, res) => {
  let requestMetadata = {};
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (requestUrl.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        concurrency: FETCH_CONCURRENCY,
        default_host_concurrency: DEFAULT_HOST_CONCURRENCY,
        host_concurrency: HOST_CONCURRENCY,
        same_host_delay_ms: SAME_HOST_DELAY_MS,
        active_fetches: activeFetches,
        active_hosts: Array.from(activeHostCounts.keys()),
        active_by_host: activeFetchesByHost(),
        pending_fetches: pendingFetches.length,
        pending_by_host: pendingFetchesByHost(),
      });
      return;
    }

    if (requestUrl.pathname === '/profile') {
      sendJson(res, 200, withProfileConfig({ status: 'ok' }));
      return;
    }

    if (requestUrl.pathname === '/fetch-batch') {
      const { source, jobs } = await getBatchFetchRequest(req, requestUrl);
      const profile = readProfileConfig();
      const startedAt = Date.now();
      const results = await Promise.all(
        jobs.map((job, index) => fetchRequest({
          ...jobFetchRequestFromBatchJob(job, source, index),
          includeProfile: false,
        })),
      );

      sendJson(res, 200, withProfile({
        status: 'ok',
        batch_source: source || 'all',
        batch_count: jobs.length,
        result_count: results.length,
        total_ms: Date.now() - startedAt,
        fetched_at: new Date().toISOString(),
        results,
      }, profile));
      return;
    }

    if (requestUrl.pathname !== '/fetch') {
      sendJson(res, 404, { status: 'error', error: 'Not found' });
      return;
    }

    const { url, metadata } = await getFetchRequest(req);
    requestMetadata = metadata;
    sendJson(res, 200, await fetchRequest({ url, metadata }));
  } catch (error) {
    sendJson(res, 200, withProfileConfig(withRequestMetadata({
      status: 'error',
      error: error.message,
      fetched_at: new Date().toISOString(),
    }, requestMetadata)));
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `Job fetch server listening on http://${HOST}:${PORT} with concurrency=${FETCH_CONCURRENCY}, default_host_concurrency=${DEFAULT_HOST_CONCURRENCY}, glassdoor_concurrency=${HOST_CONCURRENCY['glassdoor.com'] || DEFAULT_HOST_CONCURRENCY}, same_host_delay_ms=${SAME_HOST_DELAY_MS}\n`,
  );
});

async function shutdown() {
  server.close();
  await resetBrowserSession();
}

process.once('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
