import { get, put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION, normalizedVector } from './_embedding.js';

const STORE_ID = process.env.ALBUM_VECTOR_STORE_ID || 'store_faCPNPhG4INYfqDO';
const PREFIX = 'vectors/v2';
const shardCache = new Map();

function safeKey(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 180);
}

export function vectorChunkKey(file, chunk = 0) {
  return `${safeKey(file)}__${String(Number(chunk) || 0).padStart(3, '0')}`;
}

export function vectorPath(file, chunk = 0) {
  return `${PREFIX}/${vectorChunkKey(file, chunk)}.json`;
}

async function credentials() {
  const oidcToken = await getVercelOidcToken().catch(() => null);
  if (!oidcToken) throw new Error('Vercel OIDC unavailable for vector store.');
  return { oidcToken, storeId: STORE_ID };
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

export async function loadVectorChunk(file, chunk = 0) {
  if (!file) return null;
  const cacheKey = vectorChunkKey(file, chunk);
  if (shardCache.has(cacheKey)) return shardCache.get(cacheKey);

  const payload = await readJson(vectorPath(file, chunk));
  if (!payload || payload.profileVersion !== PROFILE_VERSION || payload.dimensions !== EMBEDDING_DIMENSIONS) {
    shardCache.set(cacheKey, null);
    return null;
  }

  const map = new Map();
  for (const row of payload.rows || []) {
    if (!Array.isArray(row) || !row[0] || !Array.isArray(row[1])) continue;
    map.set(String(row[0]), normalizedVector(row[1]));
  }

  const entry = {
    map,
    model: payload.model,
    dimensions: payload.dimensions,
    profileVersion: payload.profileVersion,
  };
  shardCache.set(cacheKey, entry);

  if (shardCache.size > 16) {
    const oldest = shardCache.keys().next().value;
    shardCache.delete(oldest);
  }
  return entry;
}

export async function saveVectorChunk(file, chunk, rows) {
  const compactRows = rows.map(([id, vector]) => [
    String(id),
    Array.from(vector, value => Number(Number(value).toFixed(6))),
  ]);

  const payload = {
    version: 2,
    profileVersion: PROFILE_VERSION,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    file,
    chunk: Number(chunk) || 0,
    count: compactRows.length,
    generatedAt: new Date().toISOString(),
    rows: compactRows,
  };

  await writeJson(vectorPath(file, chunk), payload);
  shardCache.delete(vectorChunkKey(file, chunk));
  return payload;
}

export async function loadIndexState() {
  return await readJson(`${PREFIX}/state.json`) || {
    version: 2,
    profileVersion: PROFILE_VERSION,
    nextUnit: 0,
    completed: false,
    indexedAlbums: 0,
    indexedUnits: 0,
  };
}

export async function saveIndexState(state) {
  const payload = {
    ...state,
    version: 2,
    profileVersion: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(`${PREFIX}/state.json`, payload);
  return payload;
}
