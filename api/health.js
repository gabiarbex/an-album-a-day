import { loadIndexState } from './_vector-store.js';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION } from './_embedding.js';

export default {
  async fetch(request) {
    const origin = new URL(request.url).origin;
    const [blobState, staticManifest] = await Promise.all([
      loadIndexState().catch(() => null),
      fetch(new URL('/data/vectors/v3/manifest.json', origin), { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null),
    ]);

    return Response.json({
      ok: true,
      service: 'album-a-day-recommender',
      engine: 'hybrid-neural-reranker-v2',
      embeddingBackend: 'transformers-js',
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      profileVersion: PROFILE_VERSION,
      staticVectorIndex: staticManifest ? {
        totalAlbums: staticManifest.totalAlbums || 0,
        chunks: Array.isArray(staticManifest.chunks) ? staticManifest.chunks.length : 0,
        profileVersion: staticManifest.profileVersion || null,
        model: staticManifest.model || null,
      } : null,
      fallbackVectorIndex: blobState,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
