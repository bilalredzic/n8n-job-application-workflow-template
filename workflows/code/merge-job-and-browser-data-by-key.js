const originals = [];
const browserByKey = new Map();

for (const item of items) {
  const json = item.json || {};
  const key = String(json.job_key || '').trim();

  if (json.browser_fetch_record_type === 'browser') {
    if (key) browserByKey.set(key, json);
    continue;
  }

  originals.push(json);
}

function browserFallbackFor(original) {
  const status = original.browser_fetch_url ? 'missing_fetch_result' : 'no_url';
  return {
    browser_fetch_status: status,
    browser_description: '',
    browser_description_source: '',
    browser_page_title: '',
    browser_final_url: '',
    browser_job_closed: false,
    browser_excerpt: '',
    browser_error: status === 'missing_fetch_result'
      ? 'No browser fetch result was returned for this job.'
      : 'Browser fetch skipped.',
    browser_fetched_at: new Date().toISOString(),
    ai_profile_config: '',
    ai_profile_path: '',
    ai_profile_status: '',
    ai_profile_error: '',
  };
}

return originals
  .sort((a, b) => Number(a.browser_fetch_index ?? 0) - Number(b.browser_fetch_index ?? 0))
  .map(original => {
    const browser = browserByKey.get(String(original.job_key || '').trim()) || browserFallbackFor(original);
    const {
      browser_fetch_record_type,
      browser_fetch_source,
      ...browserFields
    } = browser;

    return {
      json: {
        ...original,
        ...browserFields,
      },
    };
  });
