import { get, put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { createHash } from 'node:crypto';
import { albumProfile, cosine, embedTexts, normalizedVector } from './_embedding.js';
import { loadVectorChunk } from './_vector-store.js';

const STORE_ID = process.env.ALBUM_FEEDBACK_STORE_ID || 'store_faCPNPhG4INYfqDO';
const PROFILE_VERSION = 1;

function clientHash(clientId) {
  return createHash('sha256').update(String(clientId || '')).digest('hex').slice(0, 32);
}

async function credentials() {
  const oidcToken = await getVercelOidcToken().catch(() => null);
  if (!oidcToken) throw new Error('Vercel OIDC unavailable for taste profile store.');
  return { oidcToken, storeId: STORE_ID };
}

function profilePath(clientId) {
  return `taste/v1/${clientHash(clientId)}.json`;
}

async function readJson(pathname) {
  const auth = await credentials();
  const result = await get(pathname, { access: 'private', ...auth }).catch(() => null);
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json();
}

async function writeJson(pathname, value) {
  const auth = await credentials();
  return put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    ...auth,
  });
}

function blankProfile() {
  return {
    version: PROFILE_VERSION,
    positive: { weight: 0, count: 0, vector: null },
    negative: { weight: 0, count: 0, vector: null },
    interactions: 0,
    bootstrapIds: [],
    updatedAt: null,
  };
}

export async function loadTasteProfile(clientId) {
  if (!clientId) return null;
  const profile = await readJson(profilePath(clientId)).catch(() => null);
  if (!profile || profile.version !== PROFILE_VERSION) return blankProfile();
  return profile;
}

function updateCentroid(bucket, vector, weight) {
  const w = Math.max(0, Number(weight) || 0);
  if (!w || !vector?.length) return bucket;

  const oldWeight = Math.max(0, Number(bucket?.weight) || 0);
  const oldVector = Array.isArray(bucket?.vector) ? bucket.vector : null;
  let next;

  if (!oldVector || !oldWeight) {
    next = normalizedVector(vector);
  } else {
    const n = Math.min(oldVector.length, vector.length);
    const mixed = new Float32Array(n);
    const total = oldWeight + w;
    for (let i = 0; i < n; i++) {
      mixed[i] = ((Number(oldVector[i]) || 0) * oldWeight + Number(vector[i] || 0) * w) / total;
    }
    next = normalizedVector(mixed);
  }

  return {
    weight: Number((oldWeight + w).toFixed(4)),
    count: (Number(bucket?.count) || 0) + 1,
    vector: Array.from(next, value => Number(Number(value).toFixed(6))),
  };
}

function tasteWeights(event, rating) {
  if (event === 'love_this') return { positive: 1.75, negative: 0 };
  if (event === 'save') return { positive: 0.65, negative: 0 };
  if (event === 'spotify_open') return { positive: 0.22, negative: 0 };
  if (event === 'rating') {
    const r = Number(rating);
    if (r >= 4.5) return { positive: 2.0, negative: 0 };
    if (r >= 3.5) return { positive: 1.1, negative: 0 };
    if (r <= 1.5) return { positive: 0, negative: 2.0 };
    if (r <= 2.5) return { positive: 0, negative: 1.0 };
  }
  return { positive: 0, negative: 0 };
}

async function albumVector(album, origin) {
  if (!album?.id) return null;

  if (album.catalogFile) {
    const stored = await loadVectorChunk(album.catalogFile, Number(album.catalogChunk) || 0, origin).catch(() => null);
    const vector = stored?.map?.get(String(album.id));
    if (vector) return vector;
  }

  const [vector] = await embedTexts([albumProfile(album)]);
  return vector || null;
}

async function albumVectors(albums, origin) {
  const rows = Array.isArray(albums) ? albums : [];
  const vectors = new Array(rows.length).fill(null);
  const groups = new Map();

  rows.forEach((album, index) => {
    if (!album?.catalogFile) return;
    const chunk = Number(album.catalogChunk) || 0;
    const key = album.catalogFile + '::' + chunk;
    if (!groups.has(key)) groups.set(key, { file: album.catalogFile, chunk, items: [] });
    groups.get(key).items.push({ album, index });
  });

  await Promise.all([...groups.values()].map(async group => {
    const stored = await loadVectorChunk(group.file, group.chunk, origin).catch(() => null);
    if (!stored?.map) return;
    for (const item of group.items) {
      const vector = stored.map.get(String(item.album.id));
      if (vector) vectors[item.index] = vector;
    }
  }));

  const missing = [];
  rows.forEach((album, index) => {
    if (!vectors[index] && album?.id) missing.push({ album, index });
  });

  if (missing.length) {
    const live = await embedTexts(missing.map(item => albumProfile(item.album)));
    missing.forEach((item, i) => {
      if (live[i]) vectors[item.index] = live[i];
    });
  }

  return vectors;
}

export async function learnTasteFromRatings(clientId, ratingRows, request) {
  const id = String(clientId || '');
  if (!id) return { learned: 0, skipped: 0, reason: 'no-client' };

  const deduped = new Map();
  for (const row of ratingRows || []) {
    if (!row?.album?.id) continue;
    const rating = Number(row.rating);
    if (!Number.isFinite(rating) || rating <= 0) continue;
    deduped.set(String(row.album.id), { album: row.album, rating: Math.max(0, Math.min(5, rating)) });
  }

  const profile = await loadTasteProfile(id) || blankProfile();
  const already = new Set(Array.isArray(profile.bootstrapIds) ? profile.bootstrapIds.map(String) : []);
  const pending = [...deduped.values()].filter(row => !already.has(String(row.album.id)));
  if (!pending.length) {
    return {
      learned: 0,
      skipped: deduped.size,
      interactions: Number(profile.interactions) || 0,
      positiveCount: Number(profile.positive?.count) || 0,
      negativeCount: Number(profile.negative?.count) || 0,
    };
  }

  const vectors = await albumVectors(pending.map(row => row.album), new URL(request.url).origin);
  let learned = 0;

  pending.forEach((row, index) => {
    const vector = vectors[index];
    if (!vector?.length) return;
    const weights = tasteWeights('rating', row.rating);
    if (!weights.positive && !weights.negative) {
      already.add(String(row.album.id));
      return;
    }
    if (weights.positive) profile.positive = updateCentroid(profile.positive, vector, weights.positive);
    if (weights.negative) profile.negative = updateCentroid(profile.negative, vector, weights.negative);
    already.add(String(row.album.id));
    learned += 1;
  });

  profile.bootstrapIds = [...already].slice(-500);
  profile.interactions = (Number(profile.interactions) || 0) + learned;
  profile.updatedAt = new Date().toISOString();
  await writeJson(profilePath(id), profile);

  return {
    learned,
    skipped: deduped.size - learned,
    interactions: profile.interactions,
    positiveCount: profile.positive.count,
    negativeCount: profile.negative.count,
  };
}



export async function learnTasteFromFeedback(event, request) {
  const clientId = String(event?.client_id || '');
  if (!clientId) return { learned: false, reason: 'no-client' };

  const weights = tasteWeights(event.event, event.rating);
  if (!weights.positive && !weights.negative) return { learned: false, reason: 'context-only' };

  const vector = await albumVector(event.album, new URL(request.url).origin);
  if (!vector) return { learned: false, reason: 'no-vector' };

  const profile = await loadTasteProfile(clientId) || blankProfile();
  if (weights.positive) profile.positive = updateCentroid(profile.positive, vector, weights.positive);
  if (weights.negative) profile.negative = updateCentroid(profile.negative, vector, weights.negative);
  profile.interactions = (Number(profile.interactions) || 0) + 1;
  profile.updatedAt = new Date().toISOString();

  await writeJson(profilePath(clientId), profile);
  return {
    learned: true,
    interactions: profile.interactions,
    positiveCount: profile.positive.count,
    negativeCount: profile.negative.count,
  };
}

export function tasteSimilarity(profile, vector) {
  if (!profile || !vector?.length) return { score: 0, confidence: 0 };
  const posVector = Array.isArray(profile.positive?.vector) ? normalizedVector(profile.positive.vector) : null;
  const negVector = Array.isArray(profile.negative?.vector) ? normalizedVector(profile.negative.vector) : null;

  const positive = posVector?.length ? cosine(posVector, vector) : 0;
  const negative = negVector?.length ? cosine(negVector, vector) : 0;
  const score = Math.max(-1, Math.min(1, positive - Math.max(0, negative) * 0.55));
  const evidence = (Number(profile.positive?.count) || 0) + (Number(profile.negative?.count) || 0);
  const confidence = Math.min(1, Math.log1p(evidence) / Math.log(16));
  return { score, confidence };
}
