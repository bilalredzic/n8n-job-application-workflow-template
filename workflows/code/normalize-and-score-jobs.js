const BLOCKED_TITLE_PARTS = [
  'apply now',
  'saved jobs',
  'similar',
  'job alert',
  'recommended jobs',
  'because you viewed',
];

const BLOCKED_SUBJECT_PATTERNS = [
  /your top job matches/i,
  /latest .+ jobs you might like/i,
  /are you still interested in these jobs/i,
  /\d+\s+more jobs?/i,
  /apply now/i,
  /saved jobs/i,
  /recommended jobs/i,
  /similar jobs?/i,
];

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

const STRONG_TECH_KEYWORDS = [
  'software',
  'developer',
  'engineer',
  'engineering',
  'backend',
  'back-end',
  'systems',
  'platform',
  'automation',
  'machine learning',
  'ml',
  'artificial intelligence',
  'ai',
  'data science',
  'data engineering',
  'data analyst',
  'data analytics',
  'cybersecurity',
  'information security',
  'security analyst',
  'devops',
  'cloud',
  'python',
  'java',
  'c++',
  'sql',
];

const WEAK_OR_NOISY_KEYWORDS = [
  'sales',
  'recruiting',
  'recruiter',
  'marketing intern',
  'human resources',
  'hr intern',
  'customer service',
  'help desk',
  'call support',
  'technician',
  'hvac',
  'aviation',
  'industrial engineering',
  'project management intern',
  'administrative',
];

const SOURCE_PATTERNS = [
  ['handshake', /handshake|joinhandshake/i],
  ['jobright', /jobright/i],
  ['linkedin', /linkedin/i],
  ['ziprecruiter', /ziprecruiter/i],
  ['glassdoor', /glassdoor/i],
];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value.text === 'string' && value.text.trim()) return value.text.trim();
  }
  return '';
}

function clean(value) {
  return String(value || '')
    .replace(/&middot;/gi, ' - ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u034F\u061C]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/["']/g, '')
    .replace(/^[\s:,-]+|[\s:,-]+$/g, '')
    .trim();
}

function sourceFor({ from, subject }) {
  const haystack = `${from} ${subject}`;
  return SOURCE_PATTERNS.find(([, pattern]) => pattern.test(haystack))?.[0] || 'gmail';
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function unwrapRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of ['url', 'u', 'target', 'redirect', 'redirect_url', 'r', 'link', 'to']) {
      const value = parsed.searchParams.get(key);
      if (value && /^https?:\/\//i.test(value)) return value;
    }
  } catch {}

  return url;
}

function cleanUrl(rawUrl) {
  const raw = decodeHtml(rawUrl)
    .trim()
    .replace(/\\u0026/g, '&')
    .replace(/^[\[(<"']+/g, '')
    .replace(/[)\].,>"'}]+$/g, '');
  if (!raw) return '';

  const linkedInJob = raw.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
  if (linkedInJob) return `https://www.linkedin.com/jobs/view/${linkedInJob[1]}/`;

  try {
    const url = new URL(unwrapRedirectUrl(raw));
    const nestedLinkedInJob = url.toString().match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
    if (nestedLinkedInJob) return `https://www.linkedin.com/jobs/view/${nestedLinkedInJob[1]}/`;

    const hostPath = `${url.hostname.toLowerCase()}${url.pathname.toLowerCase()}`;
    const preserveSearch = /ziprecruiter\.com\/(?:e?km|job)|glassdoor\.com\/partner\/joblisting\.htm|email\.notifications\.joinhandshake\.com\/c\/|joinhandshake\.com\/(?:stu\/)?jobs/i.test(hostPath);
    if (!preserveSearch) url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function isAssetOrUtilityUrl(rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return true;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const full = `${host}${path}`;

    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|map|xml)$/i.test(path)) return true;
    if (/^(static|media|images?|img|assets)\./i.test(host)) return true;
    if (/\/(static|assets|images?|img|logos?|icons?|favicon|pixel|tracking|unsubscribe|privacy|legal|help|settings|promo|premium|widget)\b/i.test(path)) return true;
    if (/unsubscribe|manage[_-]?alerts?|emailpreference|privacy|legal|help|settings|promo|premium|widget|tracking|pixel|logo|favicon/i.test(full)) return true;
    if (/doubleclick|google-analytics|facebook\.com\/tr|analytics|tracking/i.test(host)) return true;
  } catch {
    return true;
  }

  return false;
}

function jobUrlScore(rawUrl, source) {
  const url = cleanUrl(rawUrl);
  if (!url || isAssetOrUtilityUrl(url)) return -1000;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    let score = 0;

    if (/linkedin\.com$/i.test(host) && /\/jobs\/view\/\d+/.test(path)) score += 140;
    if (/jobright\.ai$/i.test(host) && /\/job|\/jobs|\/dashboard|\/recommended/i.test(path)) score += 120;
    if (/joinhandshake\.com$/i.test(host) && /\/jobs|\/stu\/jobs/i.test(path)) score += 120;
    if (/glassdoor\.com$/i.test(host) && /job|job-listing|partner/i.test(path)) score += 110;
    if (/ziprecruiter\.com$/i.test(host) && /job|jobs|candidate/i.test(path)) score += 110;
    if (/ashbyhq\.com|greenhouse\.io|lever\.co|workdayjobs\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com/i.test(host)) score += 120;

    if (source && host.includes(source)) score += 20;
    if (/job|jobs|career|careers|position|opening|req|posting/i.test(path)) score += 35;
    if (/click|redirect|track/i.test(path)) score -= 15;

    return score;
  } catch {
    return -1000;
  }
}

function collectUrlsFromText(value) {
  const text = decodeHtml(value);
  const urls = [];
  const hrefRegex = /\bhref\s*=\s*["']([^"']+)["']/gi;
  const rawUrlRegex = /https?:\/\/[^\s<>"'\])]+/gi;

  for (const match of text.matchAll(hrefRegex)) {
    urls.push({ url: match[1], href: true });
  }

  for (const match of text.matchAll(rawUrlRegex)) {
    urls.push({ url: match[0], href: false });
  }

  return urls;
}

function extractBestUrl(source, ...values) {
  const combined = values.filter(value => typeof value === 'string' && value.trim()).join('\n');
  const candidates = collectUrlsFromText(combined)
    .map(candidate => ({
      ...candidate,
      clean: cleanUrl(candidate.url),
      score: jobUrlScore(candidate.url, source) + (candidate.href ? 20 : 0),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return cleanUrl(candidates[0]?.clean || '');
}

function splitTitleCompany(subject) {
  const s = clean(subject)
    .replace(/^(?:hi|hello|hey)\s+[a-z]+,\s*/i, '')
    .replace(/^[a-z]{2,20},\s+(?=(?:new|your|you|job|jobs|we|a|an)\b)/i, '')
    .replace(/^(Job alert|Handshake|LinkedIn|ZipRecruiter|Glassdoor|Jobright):\s*/i, '')
    .replace(/\s*\|\s*(LinkedIn|ZipRecruiter|Glassdoor|Handshake|Jobright).*$/i, '')
    .replace(/\s*-\s*(LinkedIn|ZipRecruiter|Glassdoor|Handshake|Jobright).*$/i, '');

  // Jobright single-job alert:
  // "Philo Homes just posted a 90% match Software Engineer Intern ... role 35 minutes ago"
  const jobrightSingle = s.match(/^(.+?)\s+just posted a\s+\d+% match\s+(.+?)\s+role\b/i);
  if (jobrightSingle) {
    return {
      company: clean(jobrightSingle[1]),
      title: clean(jobrightSingle[2]),
    };
  }

  // Jobright hiring format:
  // "Hach is hiring for “Cybersecurity Intern” like you — 98% match from Jobright"
  const hiringFor = s.match(/^(.+?)\s+is hiring for\s+[“"']?(.+?)[”"']?(?:\s+like you|\s+—|\s+-|$)/i);
  if (hiringFor) {
    return {
      company: clean(hiringFor[1]),
      title: clean(hiringFor[2]),
    };
  }

  // LinkedIn:
  // "Summer Internship - Security Engineering role at Aledade: Actively recruiting"
  const roleAt = s.match(/^(.+?)\s+role at\s+(.+?)(?::\s*Actively recruiting)?$/i);
  if (roleAt) {
    return {
      title: clean(roleAt[1]),
      company: clean(roleAt[2]),
    };
  }

  // Generic "... at Company"
  const atPattern = s.match(/^(.+?)\s+at\s+(.+?)(?::\s*Actively recruiting)?$/i);
  if (atPattern) {
    return {
      title: clean(atPattern[1]),
      company: clean(atPattern[2]),
    };
  }

  // Generic "Title - Company"
  const dashPattern = s.match(/^(.+?)\s[-–]\s(.+)$/);
  if (dashPattern) {
    return {
      title: clean(dashPattern[1]),
      company: clean(dashPattern[2]),
    };
  }

  return { company: '', title: s };
}

function fitFor(text) {
  const lower = String(text || '').toLowerCase();
  const keywordHits = GOOD_KEYWORDS.filter(keyword => lower.includes(keyword)).length;
  const strongTechHits = STRONG_TECH_KEYWORDS.filter(keyword => lower.includes(keyword)).length;
  const weakHits = WEAK_OR_NOISY_KEYWORDS.filter(keyword => lower.includes(keyword)).length;
  let score = 35 + Math.min(keywordHits, 8) * 3;

  if (/\b(job|jobs|role|position|opening|career|careers|hiring|apply)\b/i.test(lower)) score += 6;
  if (/\b(remote|hybrid|onsite|full-time|part-time|contract|temporary|seasonal)\b/i.test(lower)) score += 3;
  score += Math.min(strongTechHits, 5) * 4;
  score -= Math.min(weakHits, 3) * 5;
  if (/\b(intern|internship|co-op|apprentice|new grad|entry level)\b/i.test(lower) && strongTechHits) score += 6;
  if (/\b(software|machine learning|data science|data engineering|cybersecurity|information security)\b/i.test(lower)) score += 4;
  if (/\b(senior|staff|principal|lead|manager|director|architect)\b/i.test(lower)) score -= 10;
  if (/\b(unpaid|commission only)\b/i.test(lower)) score -= 25;
  if (/unsubscribe|manage alerts?|email preferences|privacy policy/i.test(lower)) score -= 8;

  return Math.max(0, Math.min(72, score));
}

function priorityFor(score) {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function makeJob({ json, subject, from, source, title, company, location, url, description }) {
  const scoreText = [title, company, location, description, subject].join('\n');
  const fit_score = fitFor(scoreText);
  const priority = priorityFor(fit_score);

  const job_key = clean(`${source}-${company || 'unknown'}-${title}-${location || ''}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const note = company && title ? `${title} at ${company}` : subject;

  return {
    json: {
      date_found: new Date().toISOString(),
      email_date: json.date || '',
      company,
      title,
      location,
      url,
      source,
      description: clean(description).slice(0, 1200),
      description_source: 'email',
      fit_score,
      priority,
      resume_variant: '',
      status: 'new',
      follow_up_date: '',
      notes: note,
      source_email_subject: subject,
      subject,
      from,
      message_id: json.messageId || json.id || '',
      job_key,
    },
  };
}

function parseLinkedInDigest({ json, subject, from, source }) {
  const text = firstString(json.text, json.textPlain, json.snippet);
  if (source !== 'linkedin' || !text || !/View job:/i.test(text)) return [];

  const blocks = text.split(/\n-{5,}\n/g);
  const jobs = [];

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines[0] && /^Your job alert/i.test(lines[0])) lines.shift();

    const viewJobIndex = lines.findIndex(line => /^View job:/i.test(line));
    if (viewJobIndex === -1 || lines.length < 4) continue;

    const jobLines = lines
      .slice(0, viewJobIndex)
      .map(clean)
      .filter(Boolean)
      .filter(line => !/^your job alert/i.test(line))
      .filter(line => !/^top job picks/i.test(line))
      .filter(line => !/^new jobs match your preferences/i.test(line))
      .filter(line => !/^new recommended jobs/i.test(line))
      .filter(line => !/^based on your profile/i.test(line))
      .filter(line => !/^your saved job at .+ is still available\.?$/i.test(line))
      .filter(line => !/^your other saved jobs$/i.test(line))
      .filter(line => !/^this company is actively hiring$/i.test(line))
      .filter(line => !/^apply with resume/i.test(line))
      .filter(line => !/^high skills match$/i.test(line))
      .filter(line => !/^\d+\s+school alum(?:ni)?$/i.test(line))
      .filter(line => !/^\d+\s+connection(?:s)?$/i.test(line))
      .filter(line => !/^promoted jobs/i.test(line));

    if (jobLines.length < 3) continue;

    const [title, company, location] = jobLines.slice(-3).map(clean);
    const url = cleanUrl(lines[viewJobIndex].replace(/^View job:\s*/i, ''));
    const signals = jobLines.slice(3).map(clean).filter(Boolean);
    const description = [title, company, location, ...signals].join(' | ');

    if (!title || !company || !location) continue;
    if (/^new jobs match your preferences$/i.test(title)) continue;

    jobs.push(makeJob({ json, subject, from, source, title, company, location, url, description }));
  }

  return jobs;
}

function collectJobrightUrls(...values) {
  const seen = new Set();
  const urls = [];
  const combined = values.filter(value => typeof value === 'string' && value.trim()).join('\n');

  for (const candidate of collectUrlsFromText(combined)) {
    const url = cleanUrl(candidate.url);
    const match = url.match(/^https?:\/\/(?:www\.)?jobright\.ai\/jobs\/info\/([a-z0-9]+)/i);
    if (!match) continue;

    const normalized = `https://jobright.ai/jobs/info/${match[1]}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function stripJobrightUrls(line) {
  return clean(
    decodeHtml(line)
      .replace(/\[[^\]]*https?:\/\/[^\]]+\]/gi, ' ')
      .replace(/https?:\/\/[^\s]+/gi, ' ')
  );
}

function isJobrightNoiseLine(line) {
  return (
    !line ||
    /jobright\.ai\s+(job icon|logo)/i.test(line) ||
    /^jobright instant alert$/i.test(line) ||
    /^always be the first to apply$/i.test(line) ||
    /^apply now$/i.test(line) ||
    /^more great matches/i.test(line) ||
    /^view more opportunities$/i.test(line) ||
    /^autofill icon$/i.test(line) ||
    /^apply faster with autofill$/i.test(line) ||
    /^save time by skipping repetitive forms$/i.test(line) ||
    /^install autofill$/i.test(line) ||
    /^happy job hunting/i.test(line) ||
    /^the jobright\.ai team$/i.test(line) ||
    /^update job alert preference/i.test(line) ||
    /^unsubscribe$/i.test(line) ||
    /^explore this today/i.test(line) ||
    /^experiences, and skill sets/i.test(line)
  );
}

function looksLikeJobrightIndustry(line) {
  return /·|\b(stage|public company|private company|non profit|software|technology|intelligence|big data|finance|energy|education|automotive|electronics|aerospace|advertising|biotechnology|healthcare|furniture)\b/i.test(line);
}

function isJobrightTimeLine(line) {
  return /\b(?:minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i.test(line) || /be an early applicant/i.test(line);
}

function parseJobrightDetails(detailLines) {
  const joined = clean(
    detailLines
      .join(' / ')
      .replace(/(\/(?:hr|yr|mo))(?=[A-Z])/gi, '$1 / ')
      .replace(/(Remote)(?=\d+\+\s*referrals?)/gi, '$1 / ')
      .replace(/([A-Z]{2})(?=\d+\+\s*referrals?)/g, '$1 / ')
      .replace(/([A-Za-z)])(?=\d+\+\s*referrals?)/g, '$1 / ')
  );
  const salaryMatch = joined.match(/\$[\d,.]+K?(?:\/(?:hr|yr|mo))?\s*-\s*\$[\d,.]+K?(?:\/(?:hr|yr|mo))?/i);
  const referralMatch = joined.match(/\d+\+\s*referrals?\b/i);
  const salary = clean(salaryMatch?.[0] || '');
  const referrals = clean(referralMatch?.[0] || '');
  const remainder = clean(
    joined
      .replace(/\$[\d,.]+K?(?:\/(?:hr|yr|mo))?\s*-\s*\$[\d,.]+K?(?:\/(?:hr|yr|mo))?/gi, ' ')
      .replace(/\d+\+\s*referrals?\b/gi, ' ')
      .replace(/\b(?:minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b.*$/i, ' ')
      .replace(/be an early applicant/gi, ' ')
  ).replace(/^\/+\s*|\s*\/+$/g, '');
  const candidates = remainder
    .split(/\s*\/\s*| {2,}/)
    .map(line => clean(line).replace(/^\/+\s*|\s*\/+$/g, ''))
    .filter(Boolean)
    .filter(line => !/^\$/.test(line) && !/referrals?/i.test(line) && !isJobrightTimeLine(line));
  const location = clean(candidates.find(line => /remote|,\s*[A-Z]{2}\b|united states|metropolitan area|campus|,\s*US\b|\bUS$/i.test(line)) || candidates[0] || '');

  return {
    salary,
    referrals,
    location: /^remote$/i.test(location) ? 'Remote' : location,
    detail: joined,
  };
}

function parseJobrightDigest({ json, subject, from, source }) {
  const text = firstString(json.text, json.textPlain, json.snippet);
  if (source !== 'jobright' || !text || !/\b\d{1,3}%/.test(text)) return [];

  const urls = collectJobrightUrls(json.text, json.textPlain, json.html, json.textAsHtml, json.textHtml, json.body, json.message, json.snippet);
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(stripJobrightUrls)
    .filter(line => line && !isJobrightNoiseLine(line));
  const jobs = [];

  for (let index = 0; index < lines.length; index++) {
    const percentMatch = lines[index].match(/^(\d{1,3})%$/);
    if (!percentMatch) continue;

    const industryLine = lines[index - 1] || '';
    const hasIndustry = looksLikeJobrightIndustry(industryLine);
    const company = clean(hasIndustry ? lines[index - 2] : lines[index - 1]);
    const industry = clean(hasIndustry ? industryLine : '');
    const title = clean(lines[index + 1] || '');

    if (!company || !title || /^\$/.test(title) || /^\d{1,3}%$/.test(title)) continue;

    const detailLines = [];
    for (let next = index + 2; next < lines.length && detailLines.length < 5; next++) {
      const line = lines[next];
      if (/^\d{1,3}%$/.test(line)) break;
      if (isJobrightTimeLine(line)) break;
      detailLines.push(line);
    }

    const details = parseJobrightDetails(detailLines);
    const matchScore = `${percentMatch[1]}% match`;
    const description = [
      title,
      company,
      details.location,
      details.salary,
      details.referrals,
      matchScore,
      industry,
    ].filter(Boolean).join(' | ');

    jobs.push(makeJob({
      json,
      subject,
      from,
      source,
      title,
      company,
      location: details.location,
      url: urls[jobs.length] || '',
      description,
    }));
  }

  return jobs;
}

function parseZipRecruiterDigest({ json, subject, from, source }) {
  const text = firstString(json.text, json.textPlain);
  if (source !== 'ziprecruiter' || !text || !/ziprecruiter\.com\/(?:e?km|job)/i.test(text)) return [];

  const rawLines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const jobs = [];

  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index];
    const match = line.match(/^(.+?)\s+<((?:https?:\/\/)?www\.ziprecruiter\.com\/(?:e?km|job)[^>]+)>$/i);
    if (!match) continue;

    const title = clean(match[1]);
    const url = cleanUrl(match[2]);
    if (!title || /^(view details|view more jobs|quick apply|1-click apply|apply now)$/i.test(title)) continue;

    const detailLines = [];
    for (let next = index + 1; next < rawLines.length; next++) {
      const nextLine = rawLines[next];
      if (/^(.+?)\s+<((?:https?:\/\/)?www\.ziprecruiter\.com\/(?:e?km|km|job)[^>]+)>$/i.test(nextLine)) break;
      if (/^view details\b/i.test(nextLine)) break;
      if (/^view more jobs\b/i.test(nextLine)) break;
      detailLines.push(clean(nextLine));
    }

    const companyLine = detailLines.find(line => line.includes('•')) || '';
    const parts = companyLine.split('•').map(clean).filter(Boolean);
    const company = parts[0] || '';
    const location = parts.slice(1).join(' / ');
    const extraSignals = detailLines.filter(line => line && line !== companyLine).slice(0, 4);
    const description = [title, company, location, ...extraSignals].filter(Boolean).join(' | ');

    if (!company) continue;
    jobs.push(makeJob({ json, subject, from, source, title, company, location, url, description }));
  }

  return jobs;
}

function parseGlassdoorDigest({ json, subject, from, source }) {
  const text = firstString(json.text, json.textPlain);
  if (source !== 'glassdoor' || !text || !/glassdoor\.com\/partner\/jobListing/i.test(text)) return [];

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => clean(line))
    .filter(Boolean);
  const jobs = [];

  function isNoise(line) {
    return (
      !line ||
      /^avatar$/i.test(line) ||
      /^\[?https?:\/\//i.test(line) ||
      /^easy apply$/i.test(line) ||
      /^just posted$/i.test(line) ||
      /^\d+\s*[hd]$/i.test(line) ||
      /^\$/.test(line) ||
      /employer est/i.test(line) ||
      /^best places? to work$/i.test(line) ||
      /^actively hiring$/i.test(line) ||
      /glassdoor/i.test(line) ||
      /job alert:/i.test(line) ||
      /check out your newest listings/i.test(line) ||
      /your job listings/i.test(line)
    );
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!/glassdoor\.com\/partner\/jobListing/i.test(line)) continue;

    const urlMatch = line.match(/https?:\/\/[^\]\s]+/i);
    const url = cleanUrl(urlMatch?.[0] || '');
    if (!url) continue;

    const meaningful = [];
    for (let prev = index - 1; prev >= 0 && meaningful.length < 4; prev--) {
      const candidate = lines[prev];
      if (isNoise(candidate)) continue;
      meaningful.unshift(candidate);
    }

    const company = clean((meaningful[meaningful.length - 3] || '').replace(/\s+\d+(?:\.\d+)?\s*★.*$/i, ''));
    const title = clean(meaningful[meaningful.length - 2] || '');
    const location = clean(meaningful[meaningful.length - 1] || '');
    if (/^\d+(?:\.\d+)?\s*★$/i.test(company)) continue;
    if (!company || !title || /^(new|remote|united states)$/i.test(title)) continue;

    const description = [title, company, location].filter(Boolean).join(' | ');
    jobs.push(makeJob({ json, subject, from, source, title, company, location, url, description }));
  }

  return jobs;
}

function stripHtml(value) {
  return clean(
    decodeHtml(value)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function extractHtmlAnchors(value) {
  const html = String(value || '');
  const anchors = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    anchors.push({
      href: cleanUrl(match[1]),
      text: stripHtml(match[2]),
    });
  }

  return anchors;
}

function isHandshakeJobUrl(url) {
  const clean = cleanUrl(url).toLowerCase();
  return (
    /^https?:\/\/email\.notifications\.joinhandshake\.com\/c\//i.test(clean) ||
    /^https?:\/\/[^/]*joinhandshake\.com\/(?:stu\/)?jobs\b/i.test(clean)
  );
}

function extractHandshakeViewJobUrl(json) {
  const html = firstString(json.html, json.textHtml, json.textAsHtml, json.body, json.message);
  const anchors = extractHtmlAnchors(html);

  const direct = anchors.find(anchor => /^view job$/i.test(clean(anchor.text)) && isHandshakeJobUrl(anchor.href));
  if (direct?.href) return cleanUrl(direct.href);

  const jobCard = anchors.find(anchor => {
    const text = clean(anchor.text);
    return (
      isHandshakeJobUrl(anchor.href) &&
      /view job|job|role|position|opening|apply|intern|internship|career|hiring/i.test(text)
    );
  });
  if (jobCard?.href) return cleanUrl(jobCard.href);

  const raw = collectUrlsFromText(html)
    .map(candidate => cleanUrl(candidate.url))
    .find(isHandshakeJobUrl);

  return cleanUrl(raw || '');
}

function collectHandshakeUrls({ json, company, title }) {
  const viewJobUrl = extractHandshakeViewJobUrl(json);
  if (viewJobUrl) return viewJobUrl;

  const anchors = extractHtmlAnchors(firstString(json.html, json.textHtml, json.textAsHtml, json.body, json.message));
  const companyPattern = company ? new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const titlePattern = title ? new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

  const scored = anchors
    .map(anchor => {
      const text = clean(anchor.text);
      let score = 0;
      if (!anchor.href || isAssetOrUtilityUrl(anchor.href)) return { ...anchor, score: -1000 };
      if (/^view job$/i.test(text)) score += 120;
      if (/this new job/i.test(text)) score += 80;
      if (companyPattern?.test(text)) score += 45;
      if (titlePattern?.test(text)) score += 55;
      if (/job|jobs|stu/i.test(anchor.href)) score += 35;
      if (/joinhandshake\.com/i.test(anchor.href)) score += 25;
      if (/preference|unsubscribe|instagram|tiktok|app store|google play/i.test(text)) score -= 200;
      if (/\/u\//i.test(anchor.href)) score -= 200;
      return { ...anchor, score };
    })
    .filter(anchor => anchor.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.href || extractBestUrl('handshake', json.text, json.textPlain, json.html, json.textAsHtml, json.textHtml, json.body, json.message, json.snippet);
  return cleanUrl(best || '');
}

function isHandshakeNoiseLine(line) {
  return (
    !line ||
    /^apply early to stand out$/i.test(line) ||
    /^want better job recommendations\??$/i.test(line) ||
    /^update your preferences\.?$/i.test(line) ||
    /^view job$/i.test(line) ||
    /^instagram$/i.test(line) ||
    /^x$/i.test(line) ||
    /^tiktok$/i.test(line) ||
    /^apple app store$/i.test(line) ||
    /^google play store$/i.test(line) ||
    /^handshake$/i.test(line) ||
    /^p\.o\. box/i.test(line) ||
    /^you received this email/i.test(line) ||
    /^manage email preferences/i.test(line) ||
    /^unsubscribe$/i.test(line) ||
    /\blogo$/i.test(line)
  );
}

function parseHandshakeEmail({ json, subject, from, source }) {
  const text = firstString(json.text, json.textPlain, json.snippet);
  if (source !== 'handshake' || !text || !/view job|you might be a match|applications are due/i.test(text)) return [];

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => clean(line))
    .filter(Boolean);
  const cleanLines = lines.filter(line => !isHandshakeNoiseLine(line));
  const dueIndex = lines.findIndex(line => /^applications are due\b/i.test(line));
  const inlineDue = dueIndex >= 0 ? clean(lines[dueIndex].replace(/^applications are due\s*/i, '')) : '';
  const dueDate = inlineDue || (dueIndex >= 0 ? clean(lines[dueIndex + 1] || '') : '');
  const viewJobIndex = lines.findIndex(line => /^view job$/i.test(line));
  const detailCandidates = (viewJobIndex >= 0 ? lines.slice(0, viewJobIndex) : cleanLines)
    .map(line => clean(line))
    .filter(line => line && !isHandshakeNoiseLine(line))
    .filter(line => !/^you might be a match/i.test(line))
    .filter(line => !/^applications are due\b/i.test(line))
    .filter(line => line !== dueDate);

  let detail = detailCandidates[detailCandidates.length - 1] || '';
  let title = detailCandidates[detailCandidates.length - 2] || '';
  let company = detailCandidates[detailCandidates.length - 3] || '';

  const parsedSubject = splitTitleCompany(subject);
  if (!title || /^(internship|full-time|part-time|contract|temporary)\b/i.test(title)) title = parsedSubject.title;
  if (!company) company = parsedSubject.company;

  const detailParts = detail.split(/[•|]/).map(clean).filter(Boolean);
  const jobType = detailParts[0] || '';
  const location = detailParts.slice(1).join(' / ') || (/\bremote\b/i.test(detail) ? 'Remote' : '');
  const url = collectHandshakeUrls({ json, company, title });
  const dueText = dueDate ? `Applications due ${dueDate}` : '';
  const description = [title, company, location, jobType, dueText].filter(Boolean).join(' | ');

  if (!company || !title) return [];
  return [makeJob({ json, subject, from, source, title, company, location, url, description })];
}

function parseFallbackEmail({ json, subject, from, source }) {
  const body = firstString(
    json.text,
    json.textPlain,
    json.html,
    json.textAsHtml,
    json.textHtml,
    json.body,
    json.message,
    json.snippet,
  );

  const parsed = splitTitleCompany(subject);

  const title = clean(parsed.title)
    .replace(/^(Job alert|Handshake|LinkedIn|ZipRecruiter|Glassdoor|Jobright):\s*/i, '')
    .replace(/\bnew jobs?\b.*$/i, '')
    .replace(/\s+:?\s*Actively recruiting\s*$/i, '')
    .trim();

  const company = clean(parsed.company)
    .replace(/\s+:?\s*Actively recruiting\s*$/i, '')
    .replace(/\b(is hiring|hiring now|posted).*$/i, '')
    .trim();

  const url = extractBestUrl(source, json.text, json.textPlain, json.html, json.textAsHtml, json.textHtml, json.body, json.message, json.snippet);
  const description = clean(body).slice(0, 1200);

  return makeJob({ json, subject, from, source, title, company, location: '', url, description });
}

const seen = new Set();
const output = [];

for (const item of items) {
  const json = item.json || {};
  const subject = firstString(json.Subject, json.subject, json.headers?.subject);
  const from = firstString(json.From, json.from, json.sender, json.headers?.from);
  const source = sourceFor({ from, subject });
  const linkedinJobs = parseLinkedInDigest({ json, subject, from, source });
  const jobrightJobs = parseJobrightDigest({ json, subject, from, source });
  const handshakeJobs = parseHandshakeEmail({ json, subject, from, source });
  const zipRecruiterJobs = parseZipRecruiterDigest({ json, subject, from, source });
  const glassdoorJobs = parseGlassdoorDigest({ json, subject, from, source });
  const parsedJobs = [...linkedinJobs, ...jobrightJobs, ...handshakeJobs, ...zipRecruiterJobs, ...glassdoorJobs];

  output.push(...(parsedJobs.length ? parsedJobs : [parseFallbackEmail({ json, subject, from, source })]));
}

return output
  .filter(item => {
    const { title, subject, description, job_key, company } = item.json;
    const lowerTitle = String(title || '').toLowerCase();
    const lowerCompany = String(company || '').toLowerCase();
    const haystack = `${title} ${subject} ${description}`.toLowerCase();
    const hasGoodKeyword = GOOD_KEYWORDS.some(keyword => haystack.includes(keyword));
    const hasStrongTechKeyword = STRONG_TECH_KEYWORDS.some(keyword => haystack.includes(keyword));
    const titleLooksTechnical = STRONG_TECH_KEYWORDS.some(keyword => lowerTitle.includes(keyword));

    if (!title || title.length < 4) return false;
    if (title.length > 160) return false;
    if (/https?:\/\//i.test(title) || /https?:\/\//i.test(company || '')) return false;
    if (BLOCKED_TITLE_PARTS.some(part => lowerTitle.includes(part))) return false;
    if (/top job picks|recommended jobs|new recommended jobs|based on your profile/i.test(`${title} ${company}`)) return false;
    if (
      !/ziprecruiter|glassdoor|jobright/i.test(String(item.json.source || '')) &&
      BLOCKED_SUBJECT_PATTERNS.some(pattern => pattern.test(String(subject || ''))) &&
      !titleLooksTechnical &&
      !/\b(intern|internship|co-op|apprentice|new grad|entry level)\b/i.test(lowerTitle)
    ) return false;

    if (/^a\s+\d+%$/i.test(title)) return false;
    if (/^your top$/i.test(title)) return false;
    if (/^latest$/i.test(title)) return false;
    if (/new recommended jobs|based on your profile|promoted jobs/i.test(lowerCompany)) return false;
    if (!company && /ziprecruiter|glassdoor/i.test(String(item.json.source || ''))) return false;

    if (!hasGoodKeyword && !hasStrongTechKeyword) return false;
    if (seen.has(job_key)) return false;

    seen.add(job_key);
    return true;
  })
  .sort((a, b) => b.json.fit_score - a.json.fit_score);
