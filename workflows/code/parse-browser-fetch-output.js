function browserRow(parsed = {}) {
  return {
    json: {
      browser_fetch_record_type: 'browser',
      job_key: parsed.job_key || '',
      browser_fetch_index: parsed.browser_fetch_index ?? '',
      browser_fetch_source: parsed.browser_fetch_source || parsed.source || '',
      browser_fetch_status: parsed.status || 'unknown',
      browser_description: parsed.description || '',
      browser_description_source: parsed.description_source || '',
      browser_page_title: parsed.page_title || '',
      browser_final_url: parsed.final_url || parsed.url || '',
      browser_job_closed: Boolean(parsed.job_closed || parsed.jobClosed),
      browser_excerpt: parsed.visible_text_excerpt || '',
      browser_error: parsed.error || parsed.message || '',
      browser_fetched_at: parsed.fetched_at || '',
      ai_profile_config: parsed.profile_config || '',
      ai_profile_path: parsed.profile_path || '',
      ai_profile_status: parsed.profile_status || '',
      ai_profile_error: parsed.profile_error || '',
    },
  };
}

function emptyBatchRow() {
  return browserRow({
    status: 'empty_batch',
    error: 'No browser fetch rows were returned for this batch.',
    fetched_at: new Date().toISOString(),
  });
}

function parseStdoutRow(item) {
  const stdout = String(item.json.stdout || '').trim();
  const stderr = String(item.json.stderr || '').trim();

  try {
    return browserRow(stdout ? JSON.parse(stdout) : {});
  } catch (error) {
    return browserRow({
      status: 'parse_error',
      error: `Could not parse browser helper stdout: ${error.message}`,
      raw_stdout: stdout.slice(0, 1000),
      stderr,
    });
  }
}

const output = [];

for (const item of items) {
  const json = item.json || {};

  if (Array.isArray(json.results)) {
    const batchProfile = {
      profile_config: json.profile_config || '',
      profile_path: json.profile_path || '',
      profile_status: json.profile_status || '',
      profile_error: json.profile_error || '',
    };

    for (const result of json.results) {
      output.push(browserRow({
        ...batchProfile,
        ...result,
      }));
    }
    continue;
  }

  if (json.status || json.description || json.description_source || json.error || json.message) {
    output.push(browserRow(json));
    continue;
  }

  output.push(parseStdoutRow(item));
}

return output.length ? output : [emptyBatchRow()];
