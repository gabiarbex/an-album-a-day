import { createHash } from 'node:crypto';
import { loadIndexState } from './_vector-store.js';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION } from './_embedding.js';

async function validatedStaticIndex(origin) {
  const [manifestResponse, lookupResponse] = await Promise.all([
    fetch(new URL('/data/vectors/v3/manifest.json', origin), { cache: 'no-store' }).catch(() => null),
    fetch(new URL('/data/catalog/lookup.json', origin), { cache: 'no-store' }).catch(() => null),
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
  if (fingerprint !== manifest.catalogFingerprint) return null;

  return {
    totalAlbums: manifest.totalAlbums || 0,
    chunks: Array.isArray(manifest.chunks) ? manifest.chunks.length : 0,
    profileVersion: manifest.profileVersion,
    model: manifest.model,
    dimensions: manifest.dimensions,
    catalogFingerprint: manifest.catalogFingerprint,
  };
}

export default {
  async fetch(request) {
    const origin = new URL(request.url).origin;
    const [blobState, staticVectorIndex] = await Promise.all([
      loadIndexState().catch(() => null),
      validatedStaticIndex(origin).catch(() => null),
    ]);

    return Response.json({
      ok: true,
      service: 'album-a-day-recommender',
      engine: 'hybrid-neural-reranker-v3',
      embeddingBackend: 'transformers-js',
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      profileVersion: PROFILE_VERSION,
      staticVectorIndex,
      fallbackVectorIndex: blobState,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
