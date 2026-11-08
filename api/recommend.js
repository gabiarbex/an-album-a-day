import {
  albumProfile,
  cleanArray,
  clamp,
  cosine,
  embedTexts,
  normalizedVector,
  energyLabel,
  queryProfile,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from './_embedding.js';
import { loadVectorChunk } from './_vector-store.js';
import { loadTasteProfile, tasteSimilarity } from './_taste-store.js';
import { scoreCandidate, explanation, genreConflict, isCompilation, diverseTopK } from './_ranking-core.js';

const MAX_CANDIDATES = 96;

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

async function cachedCandidateVectors(candidates, origin) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate.catalogFile) continue;
    const chunk = Number(candidate.catalogChunk) || 0;
    const key = candidate.catalogFile + '::' + chunk;
    if (!groups.has(key)) groups.set(key, { file: candidate.catalogFile, chunk, candidates: [] });
    groups.get(key).candidates.push(candidate);
  }

  const byId = new Map();
  await Promise.all([...groups.values()].map(async group => {
    const stored = await loadVectorChunk(group.file, group.chunk, origin).catch(() => null);
    if (!stored?.map) return;
    for (const candidate of group.candidates) {
      const vector = stored.map.get(String(candidate.id));
      if (vector) byId.set(String(candidate.id), vector);
    }
  }));
  return byId;
}

export default {
  async fetch(request) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

    try {
      const body = await request.json();
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : [];
      if (candidates.length < 2) return json({ error: 'Not enough candidates.' }, 400, headers);

      const suppliedQuery = Array.isArray(body.queryVector) && body.queryVector.length === EMBEDDING_DIMENSIONS
        ? body.queryVector
        : null;
      let queryVector;
      let queryVectorSource = 'embedded';
      if (suppliedQuery && suppliedQuery.every(value => Number.isFinite(Number(value)))) {
        queryVector = normalizedVector(suppliedQuery);
        queryVectorSource = 'retrieval-reuse';
      } else {
        const query = queryProfile(body);
        [queryVector] = await embedTexts([query], EMBEDDING_DIMENSIONS);
      }
      if (!queryVector?.length) throw new Error('Query embedding was empty.');

      const cached = await cachedCandidateVectors(candidates, new URL(request.url).origin);
      const missing = candidates.filter(candidate => !cached.has(String(candidate.id)));

      if (missing.length) {
        const liveVectors = await embedTexts(missing.map(albumProfile), EMBEDDING_DIMENSIONS);
        if (liveVectors.length !== missing.length) throw new Error('Live embedding response shape mismatch.');
        missing.forEach((candidate, index) => cached.set(String(candidate.id), liveVectors[index]));
      }

      const tasteProfile = body.client_id
        ? await loadTasteProfile(body.client_id).catch(() => null)
        : null;

      const ranked = candidates.map(candidate => {
        const vector = cached.get(String(candidate.id));
        const neural = vector ? cosine(queryVector, vector) : 0;
        const taste = vector ? tasteSimilarity(tasteProfile, vector) : { score: 0, confidence: 0 };
        return {
          candidate,
          neural,
          taste,
          score: scoreCandidate(candidate, neural, body, taste),
        };
      }).sort((a, b) => b.score - a.score);

      // Explicit genre exclusions override embedding similarity whenever an
      // eligible candidate exists; hidden genres are never assumed absent.
      const avoided = Array.isArray(body.intent?.avoidGenres) ? body.intent.avoidGenres : [];
      const genreSafe = avoided.length ? ranked.filter(row => !genreConflict(row.candidate, avoided)) : ranked;
      const knownAvoided=Array.isArray(body.intent?.avoidOriginCountries)?body.intent.avoidOriginCountries:[];
      const countrySafe=(genreSafe.length?genreSafe:ranked)
        .filter(row=>!knownAvoided.includes(String(row.candidate.originCountry||'').toUpperCase()));
      const requestedCountries=Array.isArray(body.intent?.originCountries)?body.intent.originCountries:[];
      const knownOriginMatches=requestedCountries.length
        ? countrySafe.filter(row=>requestedCountries.includes(String(row.candidate.originCountry||'').toUpperCase()))
        : [];
      const vocalRequests=Array.isArray(body.intent?.vocalLanguages)?body.intent.vocalLanguages:[];
      const knownVocalMatches=vocalRequests.length?(knownOriginMatches.length?knownOriginMatches:countrySafe)
        .filter(row=>vocalRequests.some(code=>(row.candidate.vocalLanguages||[]).includes(code))):[];
      // Verified positive geography wins over embeddings; lyric language is
      // enforced only when actual album-level evidence is available.
      const eligible=knownVocalMatches.length?knownVocalMatches:
        knownOriginMatches.length?knownOriginMatches:
        countrySafe.length?countrySafe:ranked;
      const chosen=eligible[0];
      const top = diverseTopK(eligible, 5, (left, right) => {
        const a = cached.get(String(left.candidate.id));
        const b = cached.get(String(right.candidate.id));
        return a && b ? cosine(a, b) : 0;
      });
      const cacheHits = candidates.length - missing.length;

      return json({
        ok: true,
        engine: body.retrievalSelection==='weighted-rrf-v1' ? 'hybrid-neural-reranker-v5-rrf' : 'hybrid-neural-reranker-v4',
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        albumId: chosen.candidate.id,
        score: Number(chosen.score.toFixed(6)),
        diagnostics: {
          neural: Number(chosen.neural.toFixed(6)),
          local: clamp(chosen.candidate.localScore ?? 0.5),
          lexical: clamp(((Number(chosen.candidate.semanticScore) || 0) + 1) / 2),
          candidates: candidates.length,
          retrievalSelection:body.retrievalSelection==='weighted-rrf-v1'?'weighted-rrf-v1':'source-quota-v0',
          vectorCacheHits: cacheHits,
          liveEmbeddings: missing.length,
          queryVectorSource,
          taste: Number((chosen.taste?.score || 0).toFixed(6)),
          tasteConfidence: Number((chosen.taste?.confidence || 0).toFixed(6)),
          tasteAdjacency: Number((chosen.candidate.tasteAdjacency || 0).toFixed(6)),
          consideredCompilations: candidates.filter(isCompilation).length,
          chosenCompilation: isCompilation(chosen.candidate),
          excludedGenreMatches: ranked.length - genreSafe.length,
          requestedOriginCountries:requestedCountries,
          verifiedOriginMatches:knownOriginMatches.length,
          selectedOriginCountry:chosen.candidate.originCountry||null,
          requestedVocalLanguages:vocalRequests,
          verifiedVocalMatches:knownVocalMatches.length,
        },
        reason: explanation(chosen, body),
        alternatives: top.map(row => ({
          id: row.candidate.id,
          score: Number(row.score.toFixed(6)),
          neural: Number(row.neural.toFixed(6)),
          taste: Number((row.taste?.score || 0).toFixed(6)),
          tasteAdjacency: Number((row.candidate.tasteAdjacency || 0).toFixed(6)),
        })),
      }, 200, headers);
    } catch (error) {
      console.error('recommendation_error', error);
      return json(
        { error: 'Recommendation backend unavailable.', detail: String(error?.message || error).slice(0, 350) },
        503,
        headers,
      );
    }
  },
};
