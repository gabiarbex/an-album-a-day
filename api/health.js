export default {
  async fetch() {
    return Response.json({
      ok: true,
      service: 'album-a-day-recommender',
      engine: 'hybrid-neural-reranker-v1',
      aiGateway: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      feedbackStore: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
