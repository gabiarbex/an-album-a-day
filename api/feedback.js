import { put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { learnTasteFromFeedback } from './_taste-store.js';

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

function cleanArray(values, limit = 20) {
  return Array.isArray(values)
    ? values.slice(0, limit).map(value => cleanText(typeof value === 'string' ? value : value?.name, 100)).filter(Boolean)
    : [];
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
      year: cleanText(body.album?.year, 12),
      genres: cleanArray(body.album?.genres, 14),
      tags: cleanArray(body.album?.tags, 24),
      moods: cleanArray(body.album?.moods, 18),
      energy: Number.isFinite(Number(body.album?.energy)) ? Number(body.album.energy) : null,
      duration: Number.isFinite(Number(body.album?.duration)) ? Number(body.album.duration) : null,
      moodSource: cleanText(body.album?.moodSource, 100),
      moodConfidence: Number.isFinite(Number(body.album?.moodConfidence)) ? Number(body.album.moodConfidence) : 0,
      energySource: cleanText(body.album?.energySource, 100),
      energyConfidence: Number.isFinite(Number(body.album?.energyConfidence)) ? Number(body.album.energyConfidence) : 0,
      catalogFile: cleanText(body.album?.catalogFile, 140),
      catalogChunk: Number.isFinite(Number(body.album?.catalogChunk)) ? Number(body.album.catalogChunk) : 0,
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

      let taste = { learned: false };
      try {
        taste = await learnTasteFromFeedback(event, request);
      } catch (error) {
        console.warn('taste_learning_error', error);
      }

      return json({ ok: true, stored, id: event.id, taste }, 202, headers);
    } catch (error) {
      console.error('feedback_error', error);
      return json({ error: String(error?.message || error).slice(0, 240) }, 400, headers);
    }
  },
};
