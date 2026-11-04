const MUSICBRAINZ_SEARCH = 'https://musicbrainz.org/ws/2/artist/';
const LISTENBRAINZ_RADIO = 'https://api.listenbrainz.org/1/lb-radio/artist/';
const USER_AGENT = 'AnAlbumADay/0.4 (https://github.com/gabiarbex/an-album-a-day)';

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

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveArtist(name) {
  const query = encodeURIComponent(`artist:"${String(name).replace(/"/g, '')}"`);
  const data = await fetchJson(`${MUSICBRAINZ_SEARCH}?query=${query}&fmt=json&limit=6`);
  const artists = Array.isArray(data?.artists) ? data.artists : [];
  if (!artists.length) return null;

  const target = normalize(name);
  const exact = artists.filter(artist =>
    normalize(artist?.name) === target || normalize(artist?.['sort-name']) === target
  );
  const pool = exact.length ? exact : artists;
  pool.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  const best = pool[0];
  return best?.id ? { mbid: best.id, name: best.name || name } : null;
}

function parseSimilarArtists(payload, seedMbid) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    rows = payload.payload || payload.recordings || payload.results || [];
    if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
      rows = rows.recordings || rows.results || [];
    }
  }

  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const mbid = row.similar_artist_mbid || row.artist_mbid;
    const name = row.similar_artist_name || row.artist_name;
    if (!mbid || !name || mbid === seedMbid || seen.has(mbid)) continue;
    seen.add(mbid);
    out.push({
      mbid,
      name: String(name).trim(),
      listens: Number(row.total_listen_count) || 0,
    });
  }
  return out;
}

async function similarArtists(mbid, mode = 'medium', limit = 10) {
  const params = new URLSearchParams({
    mode,
    max_similar_artists: String(limit),
    max_recordings_per_artist: '1',
  });
  const payload = await fetchJson(`${LISTENBRAINZ_RADIO}${encodeURIComponent(mbid)}?${params}`);
  return parseSimilarArtists(payload, mbid).slice(0, limit);
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

    try {
      const body = await request.json();
      const mode = ['easy','medium','hard'].includes(body?.mode) ? body.mode : 'medium';
      const seeds = (Array.isArray(body?.artists) ? body.artists : [])
        .slice(0, 8)
        .map(row => ({
          name: String(row?.name || '').trim().slice(0, 160),
          weight: Math.max(0.05, Math.min(1, Number(row?.weight) || 0.25)),
        }))
        .filter(row => row.name);

      if (!seeds.length) return json({ error: 'No seed artists.' }, 400, headers);

      const resolved = [];
      for (let i = 0; i < seeds.length; i += 1) {
        try {
          const artist = await resolveArtist(seeds[i].name);
          if (artist) resolved.push({ ...seeds[i], ...artist });
        } catch {}
        if (i < seeds.length - 1) await sleep(1100);
      }

      if (!resolved.length) {
        return json({ ok: true, resolvedSeeds: 0, neighbors: [] }, 200, headers);
      }

      const aggregate = new Map();
      const seedNames = new Set(seeds.map(seed => normalize(seed.name)));

      for (const seed of resolved) {
        try {
          const neighbors = await similarArtists(seed.mbid, mode, 12);
          neighbors.forEach((neighbor, rank) => {
            const name = normalize(neighbor.name);
            if (!name || seedNames.has(name)) return;
            const rankWeight = 1 / (1 + rank * 0.42);
            const popularityDamp = neighbor.listens > 0
              ? Math.min(1, 0.35 + Math.log10(neighbor.listens + 10) / 8)
              : 0.55;
            const contribution = seed.weight * rankWeight * popularityDamp;
            aggregate.set(name, (aggregate.get(name) || 0) + contribution);
          });
        } catch {}
        await sleep(250);
      }

      const ranked = [...aggregate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
      const max = ranked[0]?.[1] || 1;
      const neighbors = ranked.map(([name, score]) => [
        name,
        Number(Math.min(1, score / max).toFixed(6)),
      ]);

      return json({
        ok: true,
        mode,
        resolvedSeeds: resolved.length,
        neighbors,
        source: 'listenbrainz-artist-radio',
      }, 200, headers);
    } catch (error) {
      console.error('artist_neighbors_error', error);
      return json(
        { error: 'Could not build the collaborative artist graph.', detail: String(error?.message || error).slice(0, 300) },
        500,
        headers,
      );
    }
  },
};
