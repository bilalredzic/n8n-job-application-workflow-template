const REPROCESS_STATUSES = new Set(['refresh', 'rescore', 'retry', 'rerun']);
const SOURCE_RANK = {
  linkedin: 6,
  jobright: 5,
  glassdoor: 4,
  handshake: 4,
  gmail: 2,
  ziprecruiter: 1,
};

function clean(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|ltd|corp|corporation|company|co)\b\.?/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return normalizeText(value)
    .replace(/\b(remote|hybrid|onsite|on site)\b/g, ' ')
    .replace(/\b(united states|usa|us)\b/g, ' ')
    .replace(/\b(fall|spring|summer|winter)\s+20\d{2}\b/g, match => match)
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalUrl(rawUrl) {
  const value = clean(rawUrl);
  if (!/^https?:\/\//i.test(value)) return '';

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.toLowerCase();
    const linkedIn = `${host}${path}`.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
    if (linkedIn) return `linkedin:${linkedIn[1]}`;

    const jobright = `${host}${path}`.match(/jobright\.ai\/jobs\/info\/([a-z0-9]+)/i);
    if (jobright) return `jobright:${jobright[1]}`;

    const glassdoorId = url.searchParams.get('jobListingId') || url.searchParams.get('jl');
    if (host.endsWith('glassdoor.com') && glassdoorId) return `glassdoor:${glassdoorId}`;

    const zipId = url.searchParams.get('jobid') || url.searchParams.get('jid') || url.searchParams.get('lvk');
    if (host.endsWith('ziprecruiter.com') && zipId) return `ziprecruiter:${zipId}`;

    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|src$|source$|campaign$|content$|cb$|guid$|uido$|cs$|jrtk$|tgt$|vt$|ao$|s$|pos$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return `${host}${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function semanticKey(json) {
  const company = normalizeText(json.company);
  const title = normalizeTitle(json.title);
  if (!company || !title) return '';
  return `${company}|${title}`;
}

function exactKey(json) {
  return clean(json.job_key).toLowerCase();
}

function shouldReprocessMemory(json) {
  return REPROCESS_STATUSES.has(clean(json.status).toLowerCase());
}

function looksLikeCandidate(json) {
  return (
    json.sheet_memory_record_type !== 'existing_sheet_row' &&
    Boolean(clean(json.job_key) || clean(json.title) || clean(json.url)) &&
    Boolean(clean(json.source_email_subject) || clean(json.message_id) || clean(json.from) || clean(json.email_date))
  );
}

function candidateRank(json) {
  const source = clean(json.source).toLowerCase();
  const sourceRank = SOURCE_RANK[source] || 0;
  const fit = Number(json.fit_score || 0);
  const hasUrl = /^https?:\/\//i.test(clean(json.url)) ? 5 : 0;
  const descriptionBonus = Math.min(5, Math.floor(clean(json.description).length / 300));
  return fit * 10 + sourceRank * 4 + hasUrl + descriptionBonus;
}

const existingExact = new Set();
const existingUrl = new Set();
const existingSemantic = new Set();
const candidates = [];

for (const item of items) {
  const json = item.json || {};

  if (json.sheet_memory_record_type === 'existing_sheet_row') {
    if (shouldReprocessMemory(json)) continue;

    const key = exactKey(json);
    const url = canonicalUrl(json.url);
    const semantic = semanticKey(json);
    if (key) existingExact.add(key);
    if (url) existingUrl.add(url);
    if (semantic) existingSemantic.add(semantic);
    continue;
  }

  if (looksLikeCandidate(json)) candidates.push(item);
}

const grouped = new Map();
const groupByUrl = new Map();
const groupBySemantic = new Map();
const skipped = {
  existing_exact: 0,
  existing_url: 0,
  existing_semantic: 0,
  in_run_duplicate: 0,
};

for (const item of candidates) {
  const json = item.json || {};
  const key = exactKey(json);
  const url = canonicalUrl(json.url);
  const semantic = semanticKey(json);

  if (key && existingExact.has(key)) {
    skipped.existing_exact += 1;
    continue;
  }
  if (url && existingUrl.has(url)) {
    skipped.existing_url += 1;
    continue;
  }
  if (semantic && existingSemantic.has(semantic)) {
    skipped.existing_semantic += 1;
    continue;
  }

  const urlGroup = url ? groupByUrl.get(url) : '';
  const semanticGroup = semantic ? groupBySemantic.get(semantic) : '';
  const groupKey = semanticGroup || urlGroup || semantic || url || key || JSON.stringify(json);
  const previous = grouped.get(groupKey);
  if (!previous || candidateRank(json) > candidateRank(previous.json || {})) {
    if (previous) skipped.in_run_duplicate += 1;
    grouped.set(groupKey, item);
  } else {
    skipped.in_run_duplicate += 1;
  }

  if (url) groupByUrl.set(url, groupKey);
  if (semantic) groupBySemantic.set(semantic, groupKey);
}

return [...grouped.entries()]
  .map(([groupKey, item], index) => ({
    json: {
      ...item.json,
      pre_ai_dedupe_group_key: groupKey,
      pre_ai_dedupe_index: index,
      pre_ai_existing_exact_skipped: skipped.existing_exact,
      pre_ai_existing_url_skipped: skipped.existing_url,
      pre_ai_existing_semantic_skipped: skipped.existing_semantic,
      pre_ai_in_run_duplicate_skipped: skipped.in_run_duplicate,
    },
  }))
  .sort((a, b) => Number(b.json.fit_score || 0) - Number(a.json.fit_score || 0));
