function clean(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanProfile(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function section(label, value) {
  const text = clean(value);
  return text ? `${label}: ${text}` : `${label}:`;
}

function truncate(value, length) {
  const text = clean(value);
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

return items.map(item => {
  const json = item.json || {};
  const profileConfig = cleanProfile(json.ai_profile_config);
  const profileStatus = clean(json.ai_profile_status);
  const profileWarning = profileConfig
    ? ''
    : `WARNING: profile.md was not available from the local fetch server${
        profileStatus ? ` (status: ${profileStatus})` : ''
      }${json.ai_profile_error ? `: ${clean(json.ai_profile_error)}` : ''}.`;

  const prompt = [
    '/no_think',
    'You are a strict JSON scoring function. Return exactly one raw JSON object and nothing else.',
    'Do not include markdown, code fences, comments, explanations, analysis, chain-of-thought, or text before/after the JSON.',
    'Every required key must be present. Use double quotes for all JSON strings. Do not use trailing commas.',
    'fit_score must be an integer number, not a string.',
    'priority must be exactly one of: high, medium, low.',
    'recommendation must be exactly one of: apply, consider, skip.',
    'confidence must be exactly one of: high, medium, low.',
    'strengths and risks must be arrays of strings, even if there is only one item.',
    'resume_variant must be a non-empty string such as software, data, ml, security, general, or none.',
    '',
    'Review this job for the candidate using only the candidate profile and ranking config below.',
    'The candidate profile is the single source of truth for target roles, skills, locations, constraints, avoid rules, salary preferences, and resume/customization angles.',
    'Do not assume candidate-specific facts that are not in the profile.',
    'The deterministic score is only a crude extraction/routing baseline, not a recommendation. Do not copy it or anchor on it.',
    'Use the full 0-100 scale from the profile score calibration. Do not default to 85.',
    'Scores of 85 or higher must be rare and reserved for clearly excellent matches with concrete evidence.',
    'Apply any ranking rules, strict decision guidance, caps, and daily-output preferences in the profile exactly.',
    'Be strict about jobs the profile says to avoid, seniority/experience mismatches, unpaid roles, vague postings, closed jobs, and clearly unmet requirements.',
    'Be decisive. Use "skip" for weak, noisy, backup-only, stale, senior, unrelated, or barely relevant jobs. Use "consider" only when the job is genuinely worth manual review. Use "apply" only for clearly strong apply-now matches.',
    'Do not reward or penalize a job just because of the email source. Jobright match percentages, Glassdoor badges, LinkedIn connection counts, promoted labels, and similar source-specific marketing text are not candidate evidence.',
    'If the title/company/location metadata appears polluted but the browser-rendered description reveals the real role, score the real role and mention the metadata risk briefly.',
    'Use the full description when available. If the description is only an email snippet, lower confidence instead of guessing.',
    'Treat preferred qualifications lightly. Penalize required qualifications that the profile clearly does not satisfy.',
    'Choose resume_variant as a short label from the profile if it defines resume variants or role angles; otherwise use "general" or "none".',
    'Return only the structured JSON object requested by the parser.',
    '',
    'PROFILE CONFIG FROM profile.md:',
    profileConfig || profileWarning || 'No profile config was provided.',
    '',
    section('Title', json.title),
    section('Company', json.company),
    section('Location', json.location),
    section('URL', json.url),
    section('Source', json.source),
    section('Crude extraction/routing fit_score; do not anchor on this', json.fit_score),
    section('Crude extraction/routing priority; do not anchor on this', json.priority),
    section('Status', json.status),
    section('Description source', json.description_source),
    section('Browser/description confidence', json.ai_confidence),
    '',
    'Job description:',
    truncate(json.ai_context || json.description, 5200),
    '',
    'Existing notes:',
    truncate(json.notes, 700),
    '',
    'Decide the final score and recommendation.',
    '',
    'Return exactly this JSON shape with your final values:',
    '{',
    '  "fit_score": 0,',
    '  "priority": "low",',
    '  "recommendation": "skip",',
    '  "resume_variant": "none",',
    '  "confidence": "low",',
    '  "reason": "One concise sentence explaining the score.",',
    '  "strengths": ["One concrete match reason."],',
    '  "risks": ["One concrete concern or missing-fit reason."]',
    '}',
  ].join('\n');

  return {
    json: {
      ...json,
      ai_prompt: prompt,
      ai_profile_config: profileConfig,
      ai_profile_warning: profileWarning,
    },
  };
});
