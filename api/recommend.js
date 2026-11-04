import { getVercelOidcToken } from '@vercel/oidc';

const EMBEDDING_MODEL = process.env.ALBUM_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const MAX_CANDIDATES = 96;
const MAX_TEXT = 700;

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

function clamp(value, low = 0, high = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

function cleanArray(values, limit = 12) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => typeof value === 'string' ? value : value?.name)
    .filter(Boolean)
    .map(value => String(value).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizedVector(values) {
  const out = Float32Array.from(values || [], value => Number(value) || 0);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return out;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

function energyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n <= 3.5) return 'low energy, restrained, calm';
  if (n >= 7.5) return 'high energy, forceful, lively';
  return 'medium energy';
}

function candidateProfile(candidate) {
  const genres = cleanArray(candidate.genres);
  const tags = cleanArray(candidate.tags, 18);
  const moods = cleanArray(candidate.moods, 12);
  const year = String(candidate.year || '').slice(0, 4);
  const energy = candidate.energy == null ? '' : energyLabel(candidate.energy);
  const duration = Number(candidate.duration);
  return [
    `artist: ${String(candidate.artist || '').slice(0, 120)}`,
    `album: ${String(candidate.title || '').slice(0, 160)}`,
    year ? `released: ${year}` : '',
    genres.length ? `genres: ${genres.join(', ')}` : '',
    tags.length ? `descriptive tags: ${tags.join(', ')}` : '',
    moods.length ? `mood tags: ${moods.join(', ')}` : '',
    energy,
    Number.isFinite(duration) ? `runtime: ${Math.round(duration)} minutes` : '',
  ].filter(Boolean).join('. ').slice(0, MAX_TEXT);
}

function queryProfile(body) {
  const note = String(body.note || '').trim().slice(0, 900);
  const moods = cleanArray(body.moods, 20);
  const avoidMoods = cleanArray(body.intent?.avoidMoods ? Object.keys(body.intent.avoidMoods) : [], 12);
  const genres = cleanArray(body.intent?.genres, 10);
  const avoidGenres = cleanArray(body.intent?.avoidGenres, 10);
  const energy = body.energy == null ? '' : energyLabel(body.energy);
  const familiarity = body.comfort === 'comfort'
    ? 'prefer familiar artists and sounds'
    : body.comfort === 'exploration'
      ? 'prefer discovery and unfamiliar artists'
      : '';
  const runtime = body.time == null ? '' : `maximum runtime around ${Number(body.time)} minutes`;

  return [
    'Find an album that emotionally fits this listener request.',
    note ? `listener says: ${note}` : '',
    moods.length ? `desired feelings: ${moods.join(', ')}` : '',
    avoidMoods.length ? `avoid feelings: ${avoidMoods.join(', ')}` : '',
    genres.length ? `requested genres: ${genres.join(', ')}` : '',
    avoidGenres.length ? `avoid genres: ${avoidGenres.join(', ')}` : '',
    energy,
    familiarity,
    runtime,
    'Prioritize emotional and sonic fit over literal word overlap.',
  ].filter(Boolean).join(' ').slice(0, 1600);
}

async function embed(input) {
  const token = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
  if (!token) throw new Error('AI Gateway authentication is unavailable.');

  const response = await fetch('https://ai-gateway.vercel.sh/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      dimensions: 256,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Embedding request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  return (payload.data || [])
    .sort((a, b) => a.index - b.index)
    .map(row => normalizedVector(row.embedding));
}

function genreConflict(candidate, avoided) {
  if (!avoided.length) return false;
  const haystack = [...cleanArray(candidate.genres), ...cleanArray(candidate.tags)]
    .join(' ')
    .toLowerCase();
  return avoided.some(value => haystack.includes(String(value).toLowerCase()));
}

function scoreCandidate(candidate, neural, body) {
  const local = clamp(candidate.localScore ?? 0.5);
  const lexical = clamp(((Number(candidate.semanticScore) || 0) + 1) / 2);
  const familiarity = clamp(candidate.familiarity ?? 0);
  const taste = body.comfort === 'comfort'
    ? familiarity
    : body.comfort === 'exploration'
      ? 1 - familiarity
      : 0.5;

  let score =
    0.62 * clamp((neural + 1) / 2) +
    0.22 * local +
    0.07 * lexical +
    0.09 * taste;

  const recentArtists = new Set((body.recentArtists || []).map(value => String(value).toLowerCase()));
  if (recentArtists.has(String(candidate.artist || '').toLowerCase())) score -= 0.18;

  const avoidGenres = cleanArray(body.intent?.avoidGenres, 10);
  if (genreConflict(candidate, avoidGenres)) score -= 0.45;

  const maxRuntime = Number(body.time);
  const duration = Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration) && duration > maxRuntime) {
    score -= Math.min(0.4, 0.08 + (duration - maxRuntime) / 75);
  }

  return score;
}

function explanation(row, body) {
  const bits = [];
  if (body.moods?.length) bits.push(body.moods.slice(0, 2).join(' + '));
  if (body.energy != null) bits.push(energyLabel(body.energy).split(',')[0]);
  if (body.comfort === 'exploration') bits.push('new territory');
  if (body.comfort === 'comfort') bits.push('closer to your orbit');
  if (!bits.length) bits.push('closest overall fit');
  return bits.join(' · ');
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
      const profiles = candidates.map(candidateProfile);
      const vectors = await embed([query, ...profiles]);
      if (vectors.length !== candidates.length + 1) throw new Error('Embedding response shape mismatch.');

      const q = vectors[0];
      const ranked = candidates.map((candidate, index) => {
        const neural = cosine(q, vectors[index + 1]);
        return {
          candidate,
          neural,
          score: scoreCandidate(candidate, neural, body),
        };
      }).sort((a, b) => b.score - a.score);

      const top = ranked.slice(0, 8);
      const seed = String(body.seed || '');
      const jitter = seed
        ? Array.from(seed).reduce((n, ch) => ((n * 33) ^ ch.charCodeAt(0)) >>> 0, 5381) / 0xffffffff
        : 0;
      const chosen = top[Math.min(top.length - 1, Math.floor(jitter * Math.min(3, top.length)))] || ranked[0];

      return json({
        ok: true,
        engine: 'hybrid-neural-reranker-v1',
        model: EMBEDDING_MODEL,
        albumId: chosen.candidate.id,
        score: Number(chosen.score.toFixed(6)),
        diagnostics: {
          neural: Number(chosen.neural.toFixed(6)),
          local: clamp(chosen.candidate.localScore ?? 0.5),
          lexical: clamp(((Number(chosen.candidate.semanticScore) || 0) + 1) / 2),
          candidates: candidates.length,
        },
        reason: explanation(chosen, body),
        alternatives: top.slice(0, 5).map(row => ({
          id: row.candidate.id,
          score: Number(row.score.toFixed(6)),
        })),
      }, 200, headers);
    } catch (error) {
      console.error('recommendation_error', error);
      return json({ error: 'Recommendation backend unavailable.', detail: String(error?.message || error).slice(0, 300) }, 503, headers);
    }
  },
};
