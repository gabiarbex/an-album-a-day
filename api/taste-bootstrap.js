import { learnTasteFromRatings } from './_taste-store.js';

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

function cleanText(value, max = 240) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function cleanArray(values, limit = 24) {
  return Array.isArray(values)
    ? values.slice(0, limit).map(value => cleanText(typeof value === 'string' ? value : value?.name, 100)).filter(Boolean)
    : [];
}

function cleanAlbum(album) {
  return {
    id: cleanText(album?.id, 120),
    artist: cleanText(album?.artist, 160),
    title: cleanText(album?.title, 200),
    year: cleanText(album?.year, 12),
    genres: cleanArray(album?.genres, 14),
    tags: cleanArray(album?.tags, 24),
    moods: cleanArray(album?.moods, 18),
    energy: Number.isFinite(Number(album?.energy)) ? Number(album.energy) : null,
    duration: Number.isFinite(Number(album?.duration)) ? Number(album.duration) : null,
    moodSource: cleanText(album?.moodSource, 100),
    moodConfidence: Number.isFinite(Number(album?.moodConfidence)) ? Number(album.moodConfidence) : 0,
    energySource: cleanText(album?.energySource, 100),
    energyConfidence: Number.isFinite(Number(album?.energyConfidence)) ? Number(album.energyConfidence) : 0,
    catalogFile: cleanText(album?.catalogFile, 140),
    catalogChunk: Number.isFinite(Number(album?.catalogChunk)) ? Number(album.catalogChunk) : 0,
  };
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

    try {
      const body = await request.json();
      const clientId = cleanText(body.client_id, 120);
      if (!clientId) return json({ error: 'Missing client id.' }, 400, headers);

      const rows = (Array.isArray(body.ratings) ? body.ratings : [])
        .slice(0, 60)
        .map(row => ({
          album: cleanAlbum(row?.album),
          rating: Number.isFinite(Number(row?.rating)) ? Math.max(0, Math.min(5, Number(row.rating))) : null,
        }))
        .filter(row => row.album.id && row.album.artist && row.album.title && row.rating);

      if (!rows.length) return json({ error: 'No usable ratings.' }, 400, headers);

      const result = await learnTasteFromRatings(clientId, rows, request);
      return json({ ok: true, ...result }, 200, headers);
    } catch (error) {
      console.error('taste_bootstrap_error', error);
      return json(
        { error: 'Could not train from diary ratings.', detail: String(error?.message || error).slice(0, 300) },
        500,
        headers,
      );
    }
  },
};
