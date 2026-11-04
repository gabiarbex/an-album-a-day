import { indexNextCatalogUnits } from './_catalog-indexer.js';

export default {
  async fetch(request) {
    const expected = process.env.CRON_SECRET;
    const authorization = request.headers.get('authorization') || '';
    if (!expected || authorization !== `Bearer ${expected}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const result = await indexNextCatalogUnits(request, Number(process.env.INDEX_UNITS_PER_RUN) || 8);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('catalog_index_error', error);
      return Response.json(
        { ok: false, error: String(error?.message || error).slice(0, 500) },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  },
};
