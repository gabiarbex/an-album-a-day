import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION, normalizedVector } from './_embedding.js';

const STORE_ID = process.env.ALBUM_VECTOR_STORE_ID || 'store_faCPNPhG4INYfqDO';
const PREFIX = 'vectors/v3';
const shardCache = new Map();
const staticManifestCache = new Map();

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

async function validatedStaticManifest(origin) {
  if (!origin) return null;
  if (staticManifestCache.has(origin)) return staticManifestCache.get(origin);

  const promise = (async () => {
    const [manifestResponse, lookupResponse] = await Promise.all([
      fetch(new URL('/data/vectors/v3/manifest.json', origin), { cache: 'force-cache' }).catch(() => null),
      fetch(new URL('/data/catalog/lookup.json', origin), { cache: 'force-cache' }).catch(() => null),
    ]);
    if (!manifestResponse?.ok || !lookupResponse?.ok) return null;

    const manifest = await manifestResponse.json();
    if (
      manifest?.profileVersion !== PROFILE_VERSION ||
      Number(manifest?.dimensions) !== EMBEDDING_DIMENSIONS ||
      !manifest?.catalogFingerprint
    ) return null;

    const lookupBytes = Buffer.from(await lookupResponse.arrayBuffer());
    const fingerprint = createHash('sha256').update(lookupBytes).digest('hex');
    if (fingerprint !== manifest.catalogFingerprint) {
      console.warn('Static vector index rejected: catalog fingerprint mismatch.');
      return null;
    }
    return manifest;
  })();

  staticManifestCache.set(origin, promise);
  const result = await promise;
  if (!result) staticManifestCache.delete(origin);
  return result;
}

async function loadStaticVectorChunk(file, chunk, origin) {
  if (!origin) return null;
  const manifest = await validatedStaticManifest(origin);
  if (!manifest) return null;
  const stem = vectorChunkKey(file, chunk);
  const expected = (manifest.chunks || []).some(row => row.file === file && Number(row.chunk || 0) === Number(chunk || 0));
  if (!expected) return null;
  const base = new URL('/data/vectors/v3/', origin);
  const idsUrl = new URL(stem + '.ids.json', base);
  const vectorsUrl = new URL(stem + '.i8.bin', base);

  const [idsResponse, vectorsResponse] = await Promise.all([
    fetch(idsUrl, { cache: 'force-cache' }).catch(() => null),
    fetch(vectorsUrl, { cache: 'force-cache' }).catch(() => null),
  ]);
  if (!idsResponse?.ok || !vectorsResponse?.ok) return null;

  const ids = await idsResponse.json();
  const bytes = new Int8Array(await vectorsResponse.arrayBuffer());
  if (!Array.isArray(ids) || bytes.length !== ids.length * EMBEDDING_DIMENSIONS) return null;

  const map = new Map();
  for (let row = 0; row < ids.length; row += 1) {
    const offset = row * EMBEDDING_DIMENSIONS;
    const vector = new Float32Array(EMBEDDING_DIMENSIONS);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) vector[i] = bytes[offset + i] / 127;
    map.set(String(ids[row]), normalizedVector(vector));
  }

  return {
    map,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    profileVersion: PROFILE_VERSION,
    source: 'static-int8',
  };
}

async function loadBlobVectorChunk(file, chunk) {
  const payload = await readJson(vectorPath(file, chunk));
  if (!payload || payload.profileVersion !== PROFILE_VERSION || payload.dimensions !== EMBEDDING_DIMENSIONS) return null;

  const map = new Map();
  for (const row of payload.rows || []) {
    if (!Array.isArray(row) || !row[0] || !Array.isArray(row[1])) continue;
    map.set(String(row[0]), normalizedVector(row[1]));
  }
  return {
    map,
    model: payload.model,
    dimensions: payload.dimensions,
    profileVersion: payload.profileVersion,
    source: 'blob-float',
  };
}

export async function loadVectorChunk(file, chunk = 0, origin = null) {
  if (!file) return null;
  const cacheKey = (origin ? 'static:' + origin : 'blob:') + vectorChunkKey(file, chunk);
  if (shardCache.has(cacheKey)) return shardCache.get(cacheKey);

  let entry = await loadStaticVectorChunk(file, chunk, origin).catch(() => null);
  if (!entry) entry = await loadBlobVectorChunk(file, chunk).catch(() => null);

  shardCache.set(cacheKey, entry || null);
  if (shardCache.size > 18) {
    const oldest = shardCache.keys().next().value;
    shardCache.delete(oldest);
  }
  return entry || null;
}

export async function saveVectorChunk(file, chunk, rows) {
  const compactRows = rows.map(([id, vector]) => [
    String(id),
    Array.from(vector, value => Number(Number(value).toFixed(6))),
  ]);
  const payload = {
    version: 3,
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
  shardCache.clear();
  return payload;
}

export async function loadIndexState() {
  return await readJson(`${PREFIX}/state.json`) || {
    version: 3,
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
    version: 3,
    profileVersion: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(`${PREFIX}/state.json`, payload);
  return payload;
}
