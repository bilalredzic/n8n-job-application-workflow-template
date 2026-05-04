const GOOD_KEYWORDS = [
  'job',
  'jobs',
  'role',
  'position',
  'opening',
  'career',
  'careers',
  'hiring',
  'apply',
  'intern',
  'internship',
  'co-op',
  'entry level',
  'new grad',
  'full-time',
  'part-time',
  'remote',
  'hybrid',
  'onsite',
];

function clean(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrlSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function looksLikeLocation(value) {
  return /^(?:remote|hybrid|onsite|on-site|united states|usa|[a-z .'-]+,\s*[A-Z]{2}|[a-z .'-]+,\s*(?:michigan|illinois|california|new york|north carolina|texas|washington)|delhi(?:,\s*mi)?|new york,\s*ny|chicago,\s*il)$/i.test(clean(value));
}

function extractLocationFromExcerpt(excerpt, title, company) {
  const lines = String(excerpt || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(clean)
    .filter(Boolean);
  const titleIndex = lines.findIndex(line => line === clean(title));
  const companyIndex = lines.findIndex(line => line === clean(company));
  const start = Math.max(titleIndex, companyIndex);

  for (const line of lines.slice(start >= 0 ? start + 1 : 0, start >= 0 ? start + 8 : 12)) {
    const location = clean(line.split('·')[0]);
    if (looksLikeLocation(location)) return location;
  }

  return '';
}

function metadataFromBrowser(json) {
  const pageTitle = clean(json.browser_page_title);
  const source = clean(json.source).toLowerCase();

  if (source === 'linkedin') {
    const match = pageTitle.match(/^(.+?)\s+\|\s+(.+?)\s+\|\s+LinkedIn$/i);
    if (match) {
      return {
        title: clean(match[1]),
        company: clean(match[2]),
        location: extractLocationFromExcerpt(json.browser_excerpt, match[1], match[2]),
        source: 'linkedin_page_title',
      };
    }
  }

  if (source === 'glassdoor') {
    const match = pageTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+Job in\s+(.+?)\s+\|\s+Glassdoor$/i);
    if (match) {
      const shiftedLocation = looksLikeLocation(json.title) ? clean(json.title) : '';
      return {
        company: clean(match[1]),
        title: clean(match[2]),
        location: shiftedLocation || extractLocationFromExcerpt(json.browser_excerpt, match[2], match[1]) || clean(match[3]),
        source: 'glassdoor_page_title',
      };
    }
  }

  return null;
}

function shouldUseBrowserMetadata(json, metadata) {
  if (!metadata || clean(json.browser_fetch_status) !== 'ok') return false;

  const source = clean(json.source).toLowerCase();
  const title = clean(json.title);
  const company = clean(json.company);
  const location = clean(json.location);

  if (source === 'linkedin') {
    return (
      !title ||
      !company ||
      looksLikeLocation(company) ||
      /^\d+\s+connection/i.test(location) ||
      /^\d+\s+school alum/i.test(location) ||
      title.length < 8 ||
      company.length < 3
    );
  }

  if (source === 'glassdoor') {
    return (
      /^best places? to work$/i.test(location) ||
      looksLikeLocation(title) ||
      /^(easy apply|actively hiring|just posted|avatar)$/i.test(title) ||
      !company ||
      !title
    );
  }

  return false;
}

function correctedMetadata(json) {
  const metadata = metadataFromBrowser(json);
  if (!shouldUseBrowserMetadata(json, metadata)) return { json, note: '' };

  const corrected = {
    ...json,
    title: metadata.title || json.title,
    company: metadata.company || json.company,
    location: metadata.location || json.location,
  };
  corrected.job_key = cleanUrlSlug(`${corrected.source}-${corrected.company || 'unknown'}-${corrected.title}-${corrected.location || ''}`);

  return {
    json: corrected,
    note: `Metadata corrected from ${metadata.source}.`,
  };
}

function usableBrowserDescription(item) {
  if (item.browser_fetch_status && item.browser_fetch_status !== 'ok') return '';

  const text = clean(item.browser_description);
  if (text.length < 180) return '';

  const lower = text.toLowerCase();
  const likelyPromo =
    lower.includes('join a growing community of professionals advancing the next wave of ai') &&
    !lower.includes(String(item.company || '').toLowerCase());
  const badPage =
    /accessdenied|access denied|this xml file does not appear to have any style information|<Error>|<\/Error>/i.test(text) ||
    /^AccessDenied\s*Access Denied/i.test(text) ||
    /security verification|verifies? you are not a bot|malicious bots|performance and security by cloudflare|ray id:/i.test(text);

  if (likelyPromo || badPage) return '';
  return text;
}

function fitFor(item, description) {
  const lower = [
    item.title,
    item.company,
    item.location,
    description,
    item.subject,
  ]
    .join('\n')
    .toLowerCase();

  const keywordHits = GOOD_KEYWORDS.filter(keyword => lower.includes(keyword)).length;
  let score = 35;

  if (clean(item.title)) score += 6;
  if (clean(item.company)) score += 6;
  if (clean(item.location)) score += 3;
  if (/^https?:\/\//i.test(clean(item.url))) score += 4;
  if (description && description.length >= 180) score += 8;
  if (description && description.length >= 800) score += 4;
  score += Math.min(keywordHits, 8) * 2;

  if (!description || description.length < 80) score -= 8;
  if (/unsubscribe|manage alerts?|email preferences|privacy policy/i.test(lower)) score -= 8;

  return Math.max(0, Math.min(72, score));
}

function priorityFor(score) {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

return items
  .map(item => {
    const correction = correctedMetadata(item.json || {});
    const json = correction.json;
    const browserDescription = usableBrowserDescription(json);
    const emailDescription = clean(json.description);
    const bestDescription = browserDescription || emailDescription;
    const jobClosed = Boolean(json.browser_job_closed);
    const baseFitScore = fitFor(json, bestDescription);
    const fit_score = jobClosed ? Math.min(baseFitScore, 20) : baseFitScore;
    const priority = jobClosed ? 'low' : priorityFor(fit_score);
    const confidence = browserDescription ? 'higher' : 'lower';
    const fetchStatus = json.browser_fetch_status || 'not_run';
    const fetchSkipReason = clean(json.browser_fetch_skip_reason);
    const fetchError = clean(json.browser_error).slice(0, 180);
    let fetchNote = `Browser description unavailable (${fetchStatus}${fetchError ? `: ${fetchError}` : ''}).`;
    if (fetchStatus === 'ok' && browserDescription) {
      fetchNote = 'Browser description extracted.';
    } else if (fetchStatus === 'ok') {
      fetchNote = 'Browser description rejected as non-job or low-value page.';
    } else if (fetchStatus === 'no_url' && fetchSkipReason === 'ziprecruiter_cloudflare') {
      fetchNote = 'Browser description skipped for ZipRecruiter: Cloudflare blocks automated page fetches.';
    } else if (fetchStatus === 'no_url') {
      fetchNote = 'Browser description skipped: no URL extracted.';
    } else if (fetchStatus === 'asset_url') {
      fetchNote = 'Browser description skipped: extracted URL was an asset.';
    } else if (fetchStatus === 'access_denied') {
      fetchNote = 'Browser description skipped: target returned AccessDenied.';
    }
    if (jobClosed) {
      fetchNote += ' Jobright says this job has closed.';
    }

    return {
      json: {
        ...json,
        description: bestDescription.slice(0, 3000),
        description_source: browserDescription ? json.browser_description_source || 'browser' : json.description_source || 'email',
        fit_score,
        priority,
        status: jobClosed ? 'closed' : json.status || 'new',
        ai_confidence: confidence,
        ai_context: [
          `Title: ${json.title || ''}`,
          `Company: ${json.company || ''}`,
          `Location: ${json.location || ''}`,
          `URL: ${json.url || ''}`,
          `Source: ${json.source || ''}`,
          `Description source: ${browserDescription ? 'browser-rendered page' : 'email summary only'}`,
          '',
          bestDescription,
        ].join('\n').slice(0, 5000),
        notes: `${json.notes || ''}${correction.note ? ` | ${correction.note}` : ''} | ${fetchNote} AI confidence: ${confidence}`,
      },
    };
  })
  .sort((a, b) => Number(b.json.fit_score || 0) - Number(a.json.fit_score || 0));
