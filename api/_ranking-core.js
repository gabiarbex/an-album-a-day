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
    ? 0.08
    : body.comfort === 'comfort'
      ? 0.02
      : 0.045;

  const rawNeuralFit = clamp((neural + 1) / 2);
  const profileQuality = clamp(candidate.profileQuality ?? 0.65, 0.18, 1);
  const neuralReliability = 0.45 + 0.55 * profileQuality;
  const neuralFit = 0.5 + (rawNeuralFit - 0.5) * neuralReliability;

  let score =
    0.72 * neuralFit +
    0.16 * local +
    0.025 * lexical +
    0.055 * modePreference +
    adjacencyWeight * adjacency;

  score -= energyPenalty(candidate, body);

  const recentArtists = new Set((body.recentArtists || []).map(value => String(value).toLowerCase()));
  if (recentArtists.has(String(candidate.artist || '').toLowerCase())) score -= 0.2;

  const avoidGenres = cleanArray(body.intent?.avoidGenres, 12);
  if (genreConflict(candidate, avoidGenres)) score -= 0.55;

  const avoidMoods = body.intent?.avoidMoods ? Object.keys(body.intent.avoidMoods) : [];
  if (moodConflict(candidate, avoidMoods)) score -= 0.42;

  const maxRuntime = Number(body.time);
  const duration = Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration) && duration > maxRuntime) {
    score -= Math.min(0.45, 0.1 + (duration - maxRuntime) / 65);
  }

  if (learnedTaste.confidence > 0) {
    const modeFactor = body.comfort === 'comfort' ? 1.25 : body.comfort === 'exploration' ? 0.75 : 1;
    score += 0.16 * learnedTaste.confidence * learnedTaste.score * modeFactor;
  }

  return score;
}

export function explanation(row, body) {
  const candidate = row?.candidate || {};
  const bits = [];

  const selected = Array.isArray(body.moods) ? body.moods.filter(Boolean) : [];
  const inferred = body.intent?.moods && typeof body.intent.moods === 'object'
    ? Object.entries(body.intent.moods)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([name]) => name)
    : [];
  bits.push(...(selected.length ? selected : inferred).slice(0, 2));

  if (body.energy != null) {
    const label = energyLabel(body.energy);
    if (label.includes('very low') || label.includes('low energy')) bits.push('low energy');
    else if (label.includes('very high') || label.includes('high energy')) bits.push('high energy');
    else bits.push('medium energy');
  }

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

  const wantedGenres = cleanArray(body.intent?.genres, 8).map(value => String(value).toLowerCase());
  if (wantedGenres.length) {
    const haystack = [...cleanArray(candidate.genres, 12), ...cleanArray(candidate.tags, 18)]
      .join(' ')
      .toLowerCase();
    const genre = wantedGenres.find(value => haystack.includes(value));
    if (genre) bits.push(genre);
  }

  const unique = [...new Set(bits.filter(Boolean))].slice(0, 3);
  return unique.length ? unique.join(' · ') : 'closest overall fit';
}
