import { put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const allowed = new Set([
    'https://gabiarbex.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
  ]);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  if (allowed.has(origin) || /\.vercel\.app$/.test(new URL(origin || 'https://invalid.local').hostname)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanText(value, max = 400) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function sanitize(body) {
  const allowedEvents = new Set([
    'reroll','save','rating','spotify_open',
    'wrong_vibe','too_upbeat','too_slow','too_obvious','love_this'
  ]);
  const event = cleanText(body.event, 40);
  if (!allowedEvents.has(event)) throw new Error('Unsupported feedback event.');

  return {
    version: 1,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    event,
    client_id: cleanText(body.client_id, 120),
    album: {
      id: cleanText(body.album?.id, 120),
      artist: cleanText(body.album?.artist, 160),
      title: cleanText(body.album?.title, 200),
    },
    rating: Number.isFinite(Number(body.rating)) ? Math.max(0, Math.min(5, Number(body.rating))) : null,
    query: {
      note: cleanText(body.query?.note, 1000),
      moods: Array.isArray(body.query?.moods) ? body.query.moods.slice(0, 30).map(x => cleanText(x, 60)) : [],
      energy: body.query?.energy ?? null,
      comfort: cleanText(body.query?.comfort, 40),
      time: body.query?.time ?? null,
    },
    ranking: {
      engine: cleanText(body.ranking?.engine, 80),
      score: Number.isFinite(Number(body.ranking?.score)) ? Number(body.ranking.score) : null,
      neural: Number.isFinite(Number(body.ranking?.neural)) ? Number(body.ranking.neural) : null,
      mode: cleanText(body.ranking?.mode, 60),
    },
  };
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

    try {
      const event = sanitize(await request.json());
      let stored = false;
      const oidcToken = await getVercelOidcToken().catch(() => null);
      const storeId = process.env.ALBUM_FEEDBACK_STORE_ID || 'store_faCPNPhG4INYfqDO';

      if (oidcToken && storeId) {
        const date = event.created_at.slice(0, 10);
        await put(
          `feedback/${date}/${event.id}.json`,
          JSON.stringify(event),
          {
            access: 'private',
            addRandomSuffix: false,
            contentType: 'application/json',
            oidcToken,
            storeId,
          },
        );
        stored = true;
      } else {
        console.log('album_feedback', JSON.stringify(event));
      }

      return json({ ok: true, stored, id: event.id }, 202, headers);
    } catch (error) {
      console.error('feedback_error', error);
      return json({ error: String(error?.message || error).slice(0, 240) }, 400, headers);
    }
  },
};
