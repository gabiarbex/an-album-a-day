import { loadIndexState } from './_vector-store.js';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION } from './_embedding.js';

export default {
  async fetch() {
    const state = await loadIndexState().catch(() => null);
    return Response.json({
      ok: true,
      service: 'album-a-day-recommender',
      engine: 'hybrid-neural-reranker-v2',
      embeddingBackend: 'transformers-js',
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      profileVersion: PROFILE_VERSION,
      vectorIndex: state,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
