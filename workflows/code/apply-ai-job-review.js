function clean(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampScore(value, fallback) {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function priorityFor(score, recommendation) {
  if (recommendation === 'skip') return 'low';
  if (recommendation === 'apply' && score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function parseJsonText(value) {
  const text = clean(value);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function generationText(value) {
  const generations = value?.generations;
  if (!Array.isArray(generations)) return '';

  for (const group of generations) {
    const entries = Array.isArray(group) ? group : [group];
    for (const entry of entries) {
      const text = entry?.text ?? entry?.message?.content ?? entry?.content;
      if (typeof text === 'string' && text.trim()) return text;
    }
  }

  return '';
}

function hasReviewShape(value) {
  return (
    value &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'fit_score') &&
    Object.prototype.hasOwnProperty.call(value, 'recommendation') &&
    Object.prototype.hasOwnProperty.call(value, 'reason')
  );
}

function coerceReview(value) {
  if (!value) return null;
  if (typeof value === 'string') return parseJsonText(value);
  if (hasReviewShape(value)) return value;
  if (typeof value !== 'object') return null;

  const generatedText = generationText(value) || generationText(value.response);
  if (generatedText) return parseJsonText(generatedText);

  for (const key of ['output', 'text', 'response', 'content', 'message']) {
    const nested = value[key];
    if (!nested || nested === value) continue;
    const parsed = coerceReview(nested);
    if (parsed) return parsed;
  }

  return null;
}

function extractReview(json) {
  if (json.error) {
    return { valid: false, error: clean(json.error).slice(0, 220) || 'AI node returned an error.' };
  }

  const output = coerceReview(json);
  if (!hasReviewShape(output)) {
    return { valid: false, error: 'AI output was empty or not JSON.' };
  }

  return { valid: true, data: output };
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = clean(value).toLowerCase().replace(/[^a-z_ -]/g, '').replace(/\s+/g, '_');
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeResumeVariant(value, fallback = 'general') {
  const normalized = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return normalized || fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, 3);
  const text = clean(value);
  return text ? [text] : [];
}

function appendNote(existing, note) {
  const base = clean(existing);
  const extra = clean(note);
  if (!extra) return base;
  const combined = base ? `${base} | ${extra}` : extra;
  return combined.slice(0, 1400);
}

function decisiveRecommendation(rawRecommendation, score, json, confidence) {
  const recommendation = normalizeChoice(rawRecommendation, ['apply', 'consider', 'skip'], 'skip');
  const status = clean(json.status).toLowerCase();
  const source = clean(json.source).toLowerCase();
  const descriptionSource = clean(json.description_source).toLowerCase();

  if (status === 'closed' || score <= 39) return 'skip';
  if (score < 65) return 'skip';
  if (confidence === 'low' && score < 75) return 'skip';
  if ((source === 'ziprecruiter' || descriptionSource === 'email') && score < 75) return 'skip';
  if (recommendation === 'skip') return 'skip';
  if (score >= 80 && recommendation === 'apply') return 'apply';
  if (score >= 80 && confidence === 'high') return 'apply';
  return 'consider';
}

function calibratedScore(score, json, confidence) {
  let calibrated = score;
  const source = clean(json.source).toLowerCase();
  const descriptionSource = clean(json.description_source).toLowerCase();

  if ((source === 'ziprecruiter' || descriptionSource === 'email') && calibrated > 75) calibrated = 75;
  if (confidence === 'low' && calibrated > 72) calibrated = 72;
  if (json.status === 'closed') calibrated = Math.min(calibrated, 20);

  return calibrated;
}

return items
  .map(item => {
    const json = item.json || {};
    const baselineScore = clampScore(json.fit_score, 0);
    const review = extractReview(json);

    if (!review.valid) {
      return {
        json: {
          ...json,
          fit_score: baselineScore,
          priority: json.priority || priorityFor(baselineScore, 'consider'),
          notes: appendNote(json.notes, `AI review unavailable; kept deterministic score. ${review.error}`),
        },
      };
    }

    const data = review.data;
    const rawScore = clampScore(data.fit_score, baselineScore);
    const confidence = normalizeChoice(data.confidence, ['high', 'medium', 'low'], json.ai_confidence || 'medium');
    const aiScore = calibratedScore(rawScore, json, confidence);
    const recommendation = decisiveRecommendation(data.recommendation, aiScore, json, confidence);
    const finalPriority = priorityFor(aiScore, recommendation);
    const resumeVariant = normalizeResumeVariant(data.resume_variant, json.resume_variant || 'general');
    const reason = clean(data.reason).slice(0, 280) || 'No concise reason returned.';
    const strengths = list(data.strengths);
    const risks = list(data.risks);
    const details = [
      `AI ${recommendation}/${finalPriority}/${aiScore}: ${reason}`,
      strengths.length ? `Strengths: ${strengths.join('; ')}` : '',
      risks.length ? `Risks: ${risks.join('; ')}` : '',
    ].filter(Boolean).join(' ');

    return {
      json: {
        ...json,
        fit_score: aiScore,
        priority: finalPriority,
        resume_variant: recommendation === 'skip' || resumeVariant === 'none' ? '' : resumeVariant,
        status: json.status === 'closed' ? 'closed' : json.status || 'new',
        notes: appendNote(json.notes, details),
        ai_recommendation: recommendation,
        ai_reason: reason,
        ai_score: aiScore,
        ai_confidence: confidence,
        ai_review_valid: true,
      },
    };
  })
  .sort((a, b) => Number(b.json.fit_score || 0) - Number(a.json.fit_score || 0));
