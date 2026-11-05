function clamp(value, low = 0, high = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

function cleanArray(values, limit = 16) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => typeof value === 'string' ? value : value?.name)
    .filter(Boolean)
    .map(value => String(value).trim().replace(/\s+/g, ' ').slice(0, 100))
    .filter(Boolean)
    .slice(0, limit);
}

function energyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n <= 2.5) return 'very low energy, hushed, restrained';
  if (n <= 4) return 'low energy, calm, restrained';
  if (n >= 8.5) return 'very high energy, forceful, lively';
  if (n >= 6.5) return 'high energy, driving, lively';
  return 'medium energy';
}

export function genreConflict(candidate, avoided) {
  if (!avoided.length) return false;
  const haystack = [...cleanArray(candidate.genres), ...cleanArray(candidate.tags)]
    .join(' ')
    .toLowerCase();
  return avoided.some(value => haystack.includes(String(value).toLowerCase()));
}

export function moodConflict(candidate, avoided) {
  const avoid = new Set((avoided || []).map(value => String(value).toLowerCase()));
  if (!avoid.size) return false;
  const translatedGuess = String(candidate.moodSource || '') === 'musicbrainz-tag-translation';
  const reliableMoods = translatedGuess ? [] : cleanArray(candidate.moods, 20);
  const albumMoods = [...reliableMoods, ...cleanArray(candidate.tags, 24)]
    .map(value => String(value).toLowerCase());
  return albumMoods.some(value => [...avoid].some(needle => value.includes(needle)));
}

export function energyPenalty(candidate, body) {
  if (body.energy == null || candidate.energy == null) return 0;
  const translatedGuess = String(candidate.energySource || '') === 'musicbrainz-tag-translation';
  const confidence = Number(candidate.energyConfidence) || 0;
  if (translatedGuess && confidence < 0.6) return 0;
  const distance = Math.abs(Number(body.energy) - Number(candidate.energy));
  if (!Number.isFinite(distance) || distance <= 1.5) return 0;
  return Math.min(0.32, (distance - 1.5) * 0.055);
}

export function requestedGenreFit(candidate, body) {
  const wanted = cleanArray(body?.intent?.genres, 12).map(value => String(value).toLowerCase());
  if (!wanted.length) return { requested: false, known: false, match: false, matched: [] };

  const haystack = [...cleanArray(candidate.genres, 14), ...cleanArray(candidate.tags, 24)]
    .map(value => String(value).toLowerCase());
  if (!haystack.length) return { requested: true, known: false, match: false, matched: [] };

  const matched = wanted.filter(needle =>
    haystack.some(value => value.includes(needle) || needle.includes(value))
  );
  return { requested: true, known: true, match: matched.length > 0, matched };
}

export function requestedMoodFit(candidate, body) {
  const inferred = body?.intent?.moods && typeof body.intent.moods === 'object'
    ? Object.keys(body.intent.moods)
    : [];
  const wanted = [...new Set([
    ...cleanArray(body?.moods, 24),
    ...cleanArray(inferred, 24),
  ].map(value => String(value).toLowerCase()))];
  if (!wanted.length) return { requested: false, known: false, match: false, matched: [] };

  const translatedGuess = String(candidate.moodSource || '') === 'musicbrainz-tag-translation';
  const reliableMoods = translatedGuess
    ? []
    : cleanArray(candidate.moods, 20).map(value => String(value).toLowerCase());
  const tags = cleanArray(candidate.tags, 24).map(value => String(value).toLowerCase());

  const matched = wanted.filter(needle =>
    reliableMoods.some(value => value.includes(needle) || needle.includes(value)) ||
    tags.some(value => value === needle || value.startsWith(needle + ' ') || value.endsWith(' ' + needle))
  );

  return {
    requested: true,
    known: reliableMoods.length > 0,
    match: matched.length > 0,
    matched,
  };
}

function reliableEnergyDistance(candidate, body) {
  if (body?.energy == null || candidate?.energy == null) return null;
  const translatedGuess = String(candidate.energySource || '') === 'musicbrainz-tag-translation';
  const confidence = Number(candidate.energyConfidence) || 0;
  if (translatedGuess && confidence < 0.6) return null;
  const distance = Math.abs(Number(body.energy) - Number(candidate.energy));
  return Number.isFinite(distance) ? distance : null;
}

export function scoreCandidate(candidate, neural, body, learnedTaste = { score: 0, confidence: 0 }) {
  const local = clamp(candidate.localScore ?? 0.5);
  const lexical = clamp(((Number(candidate.semanticScore) || 0) + 1) / 2);
  const familiarity = clamp(candidate.familiarity ?? 0);
  const modePreference = body.comfort === 'comfort'
    ? familiarity
    : body.comfort === 'exploration'
      ? 1 - familiarity
      : 0.5;
  const adjacency = familiarity < 0.25 ? clamp(candidate.tasteAdjacency ?? 0) : 0;
  const adjacencyWeight = body.comfort === 'exploration'
    ? 0.075
    : body.comfort === 'comfort'
      ? 0.015
      : 0.04;

  const rawNeuralFit = clamp((neural + 1) / 2);
  const profileQuality = clamp(candidate.profileQuality ?? 0.65, 0.18, 1);
  const neuralReliability = 0.45 + 0.55 * profileQuality;
  const neuralFit = 0.5 + (rawNeuralFit - 0.5) * neuralReliability;

  const genreFit = requestedGenreFit(candidate, body);
  const moodFit = requestedMoodFit(candidate, body);
  const avoidGenres = cleanArray(body.intent?.avoidGenres, 12);
  const avoidMoods = body.intent?.avoidMoods ? Object.keys(body.intent.avoidMoods) : [];
  const hasExplicitControls = Boolean(
    body.energy != null ||
    body.time != null ||
    genreFit.requested ||
    moodFit.requested ||
    avoidGenres.length ||
    avoidMoods.length
  );

  const neuralWeight = hasExplicitControls ? 0.56 : 0.66;
  const localWeight = hasExplicitControls ? 0.27 : 0.20;
  const lexicalWeight = String(body.note || '').trim() ? 0.04 : 0.02;
  const modeWeight = 0.05;

  let score =
    neuralWeight * neuralFit +
    localWeight * local +
    lexicalWeight * lexical +
    modeWeight * modePreference +
    adjacencyWeight * adjacency;

  // Explicit positive controls should beat a superficially stronger embedding.
  if (genreFit.match) score += 0.11;
  else if (genreFit.known) score -= 0.18;

  if (moodFit.match) score += 0.10;
  else if (moodFit.known) score -= 0.10;

  const energyDistance = reliableEnergyDistance(candidate, body);
  if (energyDistance !== null && energyDistance <= 1.5) score += 0.07;

  score -= energyPenalty(candidate, body);

  const recentArtists = new Set((body.recentArtists || []).map(value => String(value).toLowerCase()));
  if (recentArtists.has(String(candidate.artist || '').toLowerCase())) score -= 0.22;

  if (genreConflict(candidate, avoidGenres)) score -= 0.62;
  if (moodConflict(candidate, avoidMoods)) score -= 0.48;

  const maxRuntime = Number(body.time);
  const duration = Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration)) {
    if (duration > maxRuntime) {
      score -= Math.min(0.48, 0.11 + (duration - maxRuntime) / 62);
    } else if (duration <= maxRuntime + 2) {
      score += 0.035;
    }
  }

  // Personal taste stays a prior, never the main retrieval objective.
  if (learnedTaste.confidence > 0) {
    const modeFactor = body.comfort === 'comfort' ? 1.15 : body.comfort === 'exploration' ? 0.72 : 0.9;
    score += 0.11 * learnedTaste.confidence * learnedTaste.score * modeFactor;
  }

  return score;
}

export function explanation(row, body) {
  const candidate = row?.candidate || {};
  const bits = [];

  const moodFit = requestedMoodFit(candidate, body);
  if (moodFit.match) bits.push(...moodFit.matched.slice(0, 1));

  const energyDistance = reliableEnergyDistance(candidate, body);
  if (energyDistance !== null && energyDistance <= 2) {
    const label = energyLabel(body.energy);
    if (label.includes('very low') || label.includes('low energy')) bits.push('low energy');
    else if (label.includes('very high') || label.includes('high energy')) bits.push('high energy');
    else bits.push('medium energy');
  }

  const genreFit = requestedGenreFit(candidate, body);
  if (genreFit.match) bits.push(...genreFit.matched.slice(0, 1));

  const adjacency = Number(candidate.tasteAdjacency) || 0;
  const familiarity = Number(candidate.familiarity) || 0;
  if (adjacency >= 0.35 && familiarity < 0.25) bits.push('taste-neighbor');
  if (row?.taste?.confidence >= 0.2 && row?.taste?.score > 0.08) bits.push('learned taste');

  if (body.comfort === 'comfort' && familiarity >= 0.25) bits.push('known artist');
  if (body.comfort === 'exploration' && familiarity < 0.25 && adjacency < 0.35) bits.push('new artist');

  const maxRuntime = Number(body.time);
  const duration = Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration) && duration <= maxRuntime + 3) {
    bits.push(`${Math.round(duration)} min`);
  }

  const unique = [...new Set(bits.filter(Boolean))].slice(0, 3);
  return unique.length ? unique.join(' · ') : 'overall match';
}
