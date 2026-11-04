import { getVercelOidcToken } from '@vercel/oidc';

export default {
  async fetch() {
    let oidc = false;
    try {
      oidc = Boolean(await getVercelOidcToken());
    } catch {}

    return Response.json({
      ok: true,
      service: 'album-a-day-recommender',
      engine: 'hybrid-neural-reranker-v1',
      aiGateway: Boolean(process.env.AI_GATEWAY_API_KEY || oidc),
      feedbackStore: oidc,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
