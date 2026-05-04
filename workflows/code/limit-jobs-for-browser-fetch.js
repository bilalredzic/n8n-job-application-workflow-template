const enableTotalLimit = false;
const totalLimit = 45;
const sourceCaps = {
  linkedin: 20,
  jobright: 8,
  ziprecruiter: 5,
  glassdoor: 7,
  handshake: 5,
  gmail: 3,
};

const browserFetchSources = new Set(['linkedin', 'glassdoor', 'jobright', 'handshake', 'gmail']);
const sorted = [...items].sort((a, b) => Number(b.json.fit_score || 0) - Number(a.json.fit_score || 0));
const selected = [];
const selectedKeys = new Set();
const sourceCounts = {};
let browserFetchIndex = 0;

function addItem(item, enforceCap) {
  const key = item.json.job_key || JSON.stringify(item.json);
  if (selectedKeys.has(key)) return false;
  if (enableTotalLimit && selected.length >= totalLimit) return false;

  const source = item.json.source || 'gmail';
  const cap = sourceCaps[source] || 3;
  if (enforceCap && (sourceCounts[source] || 0) >= cap) return false;

  const url = String(item.json.url || '').trim();
  const shouldFetch = browserFetchSources.has(source) && /^https?:\/\//i.test(url);
  selected.push({
    json: {
      ...item.json,
      browser_fetch_index: browserFetchIndex++,
      browser_fetch_url: shouldFetch ? url : '',
      browser_fetch_skip_reason: shouldFetch
        ? ''
        : source === 'ziprecruiter'
          ? 'ziprecruiter_cloudflare'
          : 'no_fetchable_url',
    },
  });
  selectedKeys.add(key);
  sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  return true;
}

if (enableTotalLimit) {
  for (const item of sorted) addItem(item, true);
  for (const item of sorted) addItem(item, false);
} else {
  for (const item of sorted) addItem(item, false);
}

return selected;
