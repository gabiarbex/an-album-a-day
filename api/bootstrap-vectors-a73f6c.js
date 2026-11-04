import { indexNextCatalogUnits } from './_catalog-indexer.js';

export default {
  async fetch(request) {
    try {
      const result = await indexNextCatalogUnits(request, 1);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('bootstrap_vector_error', error);
      return Response.json(
        { ok:false, error:String(error?.message || error).slice(0,500) },
        { status:500, headers:{'Cache-Control':'no-store'} }
      );
    }
  }
};
