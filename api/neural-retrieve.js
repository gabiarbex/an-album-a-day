import {
  EMBEDDING_DIMENSIONS,
  PROFILE_VERSION,
  embedTexts,
  normalizedVector,
  queryProfile,
} from './_embedding.js';

const INDEX_PATH = '/data/neural-retrieval/v1/';
let indexPromise = null;

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

async function loadIndex(origin) {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const base = new URL(INDEX_PATH, origin);
    const [manifestResponse, vectorManifestResponse] = await Promise.all([
      fetch(new URL('manifest.json', base), { cache: 'force-cache' }),
      fetch(new URL('/data/vectors/v3/manifest.json', origin), { cache: 'force-cache' }),
    ]);
    if (!manifestResponse.ok || !vectorManifestResponse.ok) throw new Error('Neural retrieval manifest unavailable.');

    const [manifest, vectorManifest] = await Promise.all([
      manifestResponse.json(),
      vectorManifestResponse.json(),
    ]);

    if (
      Number(manifest.sourceDimensions) !== EMBEDDING_DIMENSIONS ||
      Number(manifest.dimensions) !== 64 ||
      manifest.sourceProfileVersion !== PROFILE_VERSION ||
      !manifest.catalogBlobSha ||
      manifest.catalogBlobSha !== vectorManifest.catalogBlobSha
    ) {
      throw new Error('Neural retrieval index does not match the deployed vector catalog.');
    }

    const [idsResponse, vectorsResponse, projectionResponse] = await Promise.all([
      fetch(new URL(manifest.ids, base), { cache: 'force-cache' }),
      fetch(new URL(manifest.vectors, base), { cache: 'force-cache' }),
      fetch(new URL(manifest.projection.file, base), { cache: 'force-cache' }),
    ]);
    if (!idsResponse.ok || !vectorsResponse.ok || !projectionResponse.ok) {
      throw new Error('Neural retrieval index files unavailable.');
    }

    const ids = await idsResponse.json();
    const vectors = new Int8Array(await vectorsResponse.arrayBuffer());
    const projection = new Float32Array(await projectionResponse.arrayBuffer());
    const dims = Number(manifest.dimensions);
    const sourceDims = Number(manifest.sourceDimensions);

    if (!Array.isArray(ids) || ids.length !== Number(manifest.totalAlbums)) {
      throw new Error('Neural retrieval ID index shape mismatch.');
    }
    if (vectors.length !== ids.length * dims) {
      throw new Error('Neural retrieval vector index shape mismatch.');
    }
    if (projection.length !== sourceDims * dims) {
      throw new Error('Neural retrieval projection shape mismatch.');
    }

    return { manifest, ids, vectors, projection, dims, sourceDims };
  })().catch(error => {
    indexPromise = null;
    throw error;
  });

  return indexPromise;
}

function projectQuery(source, projection, sourceDims, dims) {
  const out = new Float32Array(dims);
  for (let row = 0; row < sourceDims; row += 1) {
    const value = source[row] || 0;
    if (!value) continue;
    const offset = row * dims;
    for (let col = 0; col < dims; col += 1) {
      out[col] += value * projection[offset + col];
    }
  }
  return normalizedVector(out);
}

function heapSwap(heap, a, b) {
  const tmp = heap[a];
  heap[a] = heap[b];
  heap[b] = tmp;
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].score <= heap[index].score) break;
    heapSwap(heap, parent, index);
    index = parent;
  }
}

function heapReplaceMin(heap, item) {
  heap[0] = item;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
    if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
    if (smallest === index) break;
    heapSwap(heap, index, smallest);
    index = smallest;
  }
}

function nearestProjected(query, index, limit) {
  const heap = [];
  const { ids, vectors, dims } = index;
  for (let row = 0; row < ids.length; row += 1) {
    const offset = row * dims;
    let score = 0;
    for (let col = 0; col < dims; col += 1) {
      score += query[col] * (vectors[offset + col] / 127);
    }
    const item = { id: String(ids[row]), score };
    if (heap.length < limit) heapPush(heap, item);
    else if (score > heap[0].score) heapReplaceMin(heap, item);
  }
  return heap.sort((a, b) => b.score - a.score);
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (request.method === 'GET') {
        const index = await loadIndex(new URL(request.url).origin);
        return json({
          ok: true,
          engine: 'full-catalog-neural-retrieval-v1',
          totalAlbums: index.ids.length,
          dimensions: index.dims,
          sourceDimensions: index.sourceDims,
          catalogBlobSha: index.manifest.catalogBlobSha,
        }, 200, headers);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

      const body = await request.json();
      const limit = Math.max(20, Math.min(120, Number(body.limit) || 64));
      const queryText = queryProfile(body);
      const [queryVector] = await embedTexts([queryText]);
      if (!queryVector?.length) throw new Error('Query embedding was empty.');

      const index = await loadIndex(new URL(request.url).origin);
      const projected = projectQuery(queryVector, index.projection, index.sourceDims, index.dims);
      const matches = nearestProjected(projected, index, limit);

      return json({
        ok: true,
        engine: 'full-catalog-neural-retrieval-v1',
        dimensions: index.dims,
        totalAlbums: index.ids.length,
        matches: matches.map(row => ({
          id: row.id,
          score: Number(row.score.toFixed(6)),
        })),
        queryVector: Array.from(queryVector, value => Number(Number(value).toFixed(6))),
      }, 200, headers);
    } catch (error) {
      console.error('neural_retrieval_error', error);
      return json(
        { error: 'Full-catalog neural retrieval unavailable.', detail: String(error?.message || error).slice(0, 350) },
        503,
        headers,
      );
    }
  },
};
