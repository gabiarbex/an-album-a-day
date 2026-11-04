import { loadIndexState } from './_vector-store.js';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, PROFILE_VERSION } from './_embedding.js';

export default {
  async fetch() {
    const state = await loadIndexState().catch(() => null);
    return Response.json({
      ok: true,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      profileVersion: PROFILE_VERSION,
      state,
    }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
