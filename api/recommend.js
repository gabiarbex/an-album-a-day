import {
  albumProfile,
  cleanArray,
  clamp,
  cosine,
  embedTexts,
  energyLabel,
  queryProfile,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from './_embedding.js';
import { loadVectorChunk } from './_vector-store.js';
import { loadTasteProfile, tasteSimilarity } from './_taste-store.js';

const MAX_CANDIDATES = 96;

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const allowed = new Set([
    'https://gabiarbex.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
  ]);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  if (allowed.has(origin) || /\.vercel\.app$/.test(new URL(origin || 'https://invalid.local').hostname)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function genreConflict(candidate, avoided) {
  if (!avoided.length) return false;
  const haystack = [...cleanArray(candidate.genres), ...cleanArray(candidate.tags)]
    .join(' ')
    .toLowerCase();
  return avoided.some(value => haystack.includes(String(value).toLowerCase()));
}

function moodConflict(candidate, avoided) {
  const avoid = new Set((avoided || []).map(value => String(value).toLowerCase()));
  if (!avoid.size) return false;
  const translatedGuess = String(candidate.moodSource || '') === 'musicbrainz-tag-translation';
  const reliableMoods = translatedGuess ? [] : cleanArray(candidate.moods, 20);
  const albumMoods = [...reliableMoods, ...cleanArray(candidate.tags, 24)]
    .map(value => String(value).toLowerCase());
  return albumMoods.some(value => [...avoid].some(needle => value.includes(needle)));
}

function energyPenalty(candidate, body) {
  if (body.energy == null || candidate.energy == null) return 0;
  const translatedGuess = String(candidate.energySource || '') === 'musicbrainz-tag-translation';
  const confidence = Number(candidate.energyConfidence) || 0;
  if (translatedGuess && confidence < 0.6) return 0;
  const distance = Math.abs(Number(body.energy) - Number(candidate.energy));
  if (!Number.isFinite(distance) || distance <= 1.5) return 0;
  return Math.min(0.32, (distance - 1.5) * 0.055);
}

function scoreCandidate(candidate, neural, body, learnedTaste = { score: 0, confidence: 0 }) {
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

  let score =
    0.72 * clamp((neural + 1) / 2) +
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

function explanation(row, body) {
  const bits = [];
  if (body.moods?.length) bits.push(body.moods.slice(0, 2).join(' + '));
  if (body.energy != null) bits.push(energyLabel(body.energy).split(',')[0]);
  if (body.comfort === 'exploration') bits.push('new territory');
  if (body.comfort === 'comfort') bits.push('closer to your orbit');
  if (
    row?.candidate &&
    Number(row.candidate.tasteAdjacency) >= 0.35 &&
    Number(row.candidate.familiarity) < 0.25
  ) bits.push('adjacent to your listening history');
  if (row?.taste?.confidence >= 0.2 && row?.taste?.score > 0.08) bits.push('learned from your ratings');
  if (!bits.length) bits.push('closest overall fit');
  return bits.join(' · ');
}

async function cachedCandidateVectors(candidates, origin) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate.catalogFile) continue;
    const chunk = Number(candidate.catalogChunk) || 0;
    const key = candidate.catalogFile + '::' + chunk;
    if (!groups.has(key)) groups.set(key, { file: candidate.catalogFile, chunk, candidates: [] });
    groups.get(key).candidates.push(candidate);
  }

  const byId = new Map();
  await Promise.all([...groups.values()].map(async group => {
    const stored = await loadVectorChunk(group.file, group.chunk, origin).catch(() => null);
    if (!stored?.map) return;
    for (const candidate of group.candidates) {
      const vector = stored.map.get(String(candidate.id));
      if (vector) byId.set(String(candidate.id), vector);
    }
  }));
  return byId;
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

    try {
      const body = await request.json();
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : [];
      if (candidates.length < 2) return json({ error: 'Not enough candidates.' }, 400, headers);

      const query = queryProfile(body);
      const [queryVector] = await embedTexts([query], EMBEDDING_DIMENSIONS);
      if (!queryVector?.length) throw new Error('Query embedding was empty.');

      const cached = await cachedCandidateVectors(candidates, new URL(request.url).origin);
      const missing = candidates.filter(candidate => !cached.has(String(candidate.id)));

      if (missing.length) {
        const liveVectors = await embedTexts(missing.map(albumProfile), EMBEDDING_DIMENSIONS);
        if (liveVectors.length !== missing.length) throw new Error('Live embedding response shape mismatch.');
        missing.forEach((candidate, index) => cached.set(String(candidate.id), liveVectors[index]));
      }

      const tasteProfile = body.client_id
        ? await loadTasteProfile(body.client_id).catch(() => null)
        : null;

      const ranked = candidates.map(candidate => {
        const vector = cached.get(String(candidate.id));
        const neural = vector ? cosine(queryVector, vector) : 0;
        const taste = vector ? tasteSimilarity(tasteProfile, vector) : { score: 0, confidence: 0 };
        return {
          candidate,
          neural,
          taste,
          score: scoreCandidate(candidate, neural, body, taste),
        };
      }).sort((a, b) => b.score - a.score);

      const chosen = ranked[0];
      const top = ranked.slice(0, 8);
      const cacheHits = candidates.length - missing.length;

      return json({
        ok: true,
        engine: 'hybrid-neural-reranker-v3',
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        albumId: chosen.candidate.id,
        score: Number(chosen.score.toFixed(6)),
        diagnostics: {
          neural: Number(chosen.neural.toFixed(6)),
          local: clamp(chosen.candidate.localScore ?? 0.5),
          lexical: clamp(((Number(chosen.candidate.semanticScore) || 0) + 1) / 2),
          candidates: candidates.length,
          vectorCacheHits: cacheHits,
          liveEmbeddings: missing.length,
          taste: Number((chosen.taste?.score || 0).toFixed(6)),
          tasteConfidence: Number((chosen.taste?.confidence || 0).toFixed(6)),
          tasteAdjacency: Number((chosen.candidate.tasteAdjacency || 0).toFixed(6)),
        },
        reason: explanation(chosen, body),
        alternatives: top.slice(0, 5).map(row => ({
          id: row.candidate.id,
          score: Number(row.score.toFixed(6)),
          neural: Number(row.neural.toFixed(6)),
          taste: Number((row.taste?.score || 0).toFixed(6)),
          tasteAdjacency: Number((row.candidate.tasteAdjacency || 0).toFixed(6)),
        })),
      }, 200, headers);
    } catch (error) {
      console.error('recommendation_error', error);
      return json(
        { error: 'Recommendation backend unavailable.', detail: String(error?.message || error).slice(0, 350) },
        503,
        headers,
      );
    }
  },
};
