import { albumProfile, embedTexts, stableAlbumId, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, PROFILE_VERSION } from './_embedding.js';
import { loadIndexState, saveIndexState, saveVectorChunk } from './_vector-store.js';

const EMBED_BATCH = 250;

function chunked(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Catalog fetch failed (${response.status}) for ${url}`);
  return response.json();
}

function buildUnits(manifest) {
  const size = Number(manifest.shard_size) || 1000;
  const units = [];
  const baseFile = manifest.base_file || 'base.json';
  const baseCount = Number(manifest.base_count) || 0;

  for (let offset = 0, chunk = 0; offset < baseCount; offset += size, chunk += 1) {
    units.push({
      file: baseFile,
      chunk,
      offset,
      count: Math.min(size, baseCount - offset),
    });
  }

  for (const shard of manifest.shards || []) {
    units.push({
      file: shard.file,
      chunk: 0,
      offset: 0,
      count: Number(shard.count) || size,
    });
  }
  return units;
}

async function embedAlbums(albums) {
  const records = albums
    .filter(album => album?.artist && album?.title)
    .map(album => ({
      id: stableAlbumId(album),
      profile: albumProfile(album),
    }));

  const rows = [];
  for (const batch of chunked(records, EMBED_BATCH)) {
    const vectors = await embedTexts(batch.map(row => row.profile), EMBEDDING_DIMENSIONS);
    if (vectors.length !== batch.length) {
      throw new Error(`Embedding batch shape mismatch: ${vectors.length} != ${batch.length}`);
    }
    for (let i = 0; i < batch.length; i++) rows.push([batch[i].id, vectors[i]]);
  }
  return rows;
}

export async function indexNextCatalogUnits(request, requestedLimit = 3) {
  const origin = new URL(request.url).origin;
  const manifest = await fetchJson(new URL('/data/catalog/manifest.json', origin));
  const units = buildUnits(manifest);
  let state = await loadIndexState();

  if (state.profileVersion !== PROFILE_VERSION) {
    state = {
      version: 2,
      profileVersion: PROFILE_VERSION,
      nextUnit: 0,
      completed: false,
      indexedAlbums: 0,
      indexedUnits: 0,
    };
  }

  if (state.completed || state.nextUnit >= units.length) {
    return {
      ok: true,
      completed: true,
      indexedAlbums: Number(state.indexedAlbums) || 0,
      indexedUnits: Number(state.indexedUnits) || 0,
      totalUnits: units.length,
      totalAlbums: Number(manifest.total_albums) || 0,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      profileVersion: PROFILE_VERSION,
    };
  }

  const limit = Math.max(1, Math.min(8, Number(requestedLimit) || 3));
  const sourceCache = new Map();
  const processed = [];

  for (let step = 0; step < limit && state.nextUnit < units.length; step += 1) {
    const unit = units[state.nextUnit];
    let source = sourceCache.get(unit.file);
    if (!source) {
      const payload = await fetchJson(new URL('/data/catalog/' + unit.file, origin));
      source = Array.isArray(payload) ? payload : payload.albums || [];
      sourceCache.set(unit.file, source);
    }

    const albums = source.slice(unit.offset, unit.offset + unit.count);
    const rows = await embedAlbums(albums);
    const saved = await saveVectorChunk(unit.file, unit.chunk, rows);

    state.nextUnit += 1;
    state.indexedUnits = (Number(state.indexedUnits) || 0) + 1;
    state.indexedAlbums = (Number(state.indexedAlbums) || 0) + rows.length;
    state.completed = state.nextUnit >= units.length;
    state.lastUnit = {
      file: unit.file,
      chunk: unit.chunk,
      count: rows.length,
      generatedAt: saved.generatedAt,
    };
    state = await saveIndexState(state);

    processed.push({
      file: unit.file,
      chunk: unit.chunk,
      count: rows.length,
    });
  }

  return {
    ok: true,
    completed: state.completed,
    processed,
    nextUnit: state.nextUnit,
    indexedAlbums: state.indexedAlbums,
    indexedUnits: state.indexedUnits,
    totalUnits: units.length,
    totalAlbums: Number(manifest.total_albums) || 0,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    profileVersion: PROFILE_VERSION,
  };
}
