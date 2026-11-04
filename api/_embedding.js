import { env, LogLevel, pipeline } from '@huggingface/transformers';

export const EMBEDDING_MODEL = process.env.ALBUM_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;
export const PROFILE_VERSION = 'album-profile-v4-minilm-clean';
export const MAX_PROFILE_TEXT = 900;

env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useFSCache = true;
env.cacheDir = '/tmp/album-a-day-transformers-cache';
if (LogLevel) env.logLevel = LogLevel.ERROR;

let extractorPromise = null;

export function clamp(value, low = 0, high = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

export function cleanArray(values, limit = 16) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => typeof value === 'string' ? value : value?.name)
    .filter(Boolean)
    .map(value => String(value).trim().replace(/\s+/g, ' ').slice(0, 100))
    .filter(Boolean)
    .slice(0, limit);
}

export function energyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n <= 2.5) return 'very low energy, hushed, restrained';
  if (n <= 4) return 'low energy, calm, restrained';
  if (n >= 8.5) return 'very high energy, forceful, lively';
  if (n >= 6.5) return 'high energy, driving, lively';
  return 'medium energy';
}

export function stableAlbumId(album) {
  if (album?.lookup_id) return String(album.lookup_id);
  const text = String(album?.artist || '').trim().toLowerCase() + '\0' + String(album?.title || '').trim().toLowerCase();
  let h = 14695981039346656037n;
  const p = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (const ch of text) {
    h ^= BigInt(ch.codePointAt(0));
    h = (h * p) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

function decadeLabel(year) {
  const n = Number(String(year || '').slice(0, 4));
  if (!Number.isFinite(n) || n < 1900 || n > 2100) return '';
  return `${Math.floor(n / 10) * 10}s`;
}

export function albumProfile(album) {
  const genres = cleanArray(album.genres, 14);
  const tags = cleanArray(album.tags, 24);
  const moodSource = String(album.moodSource || album.provenance?.moods?.source || '');
  const translatedMoodGuess = moodSource === 'musicbrainz-tag-translation';
  const moods = translatedMoodGuess ? [] : cleanArray(album.moods, 16);
  const featureMoods = !translatedMoodGuess && album.features?.moods && typeof album.features.moods === 'object'
    ? Object.entries(album.features.moods)
        .filter(([, value]) => Number(value) >= 0.35)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 12)
        .map(([name]) => name)
    : [];
  const year = String(album.year || album.metadata?.year || '').slice(0, 4);
  const decade = decadeLabel(year);
  const duration = [
    album._live?.runtimeMin,
    album._semantic?.runtimeMin,
    album.features?.duration_min,
    album.length_min,
    album.duration,
  ].find(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const energy = [
    album._acoustic?.energy,
    album._live?.signals?.energy,
    album.features?.energy != null ? Number(album.features.energy) * 10 : null,
    album.energy_level,
    album.energy,
  ].find(value => value !== null && value !== undefined && Number.isFinite(Number(value)));

  return [
    `artist: ${String(album.artist || '').slice(0, 140)}`,
    `album: ${String(album.title || '').slice(0, 180)}`,
    year ? `released: ${year}` : '',
    decade ? `era: ${decade}` : '',
    genres.length ? `genres and styles: ${genres.join(', ')}` : '',
    tags.length ? `descriptive music tags: ${tags.join(', ')}` : '',
    moods.length ? `catalog mood tags: ${moods.join(', ')}` : '',
    featureMoods.length ? `estimated emotional qualities: ${featureMoods.join(', ')}` : '',
    energy === undefined ? '' : energyLabel(Number(energy)),
    duration === undefined ? '' : `runtime: about ${Math.round(Number(duration))} minutes`,
    'Represent the sound, emotional character, atmosphere, intensity, and listening context of this record.',
  ].filter(Boolean).join('. ').slice(0, MAX_PROFILE_TEXT);
}

export function queryProfile(body) {
  const note = String(body.note || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
  const moods = cleanArray(body.moods, 24);
  const avoidMoods = cleanArray(body.intent?.avoidMoods ? Object.keys(body.intent.avoidMoods) : [], 16);
  const genres = cleanArray(body.intent?.genres, 12);
  const avoidGenres = cleanArray(body.intent?.avoidGenres, 12);
  const energy = body.energy == null ? '' : energyLabel(body.energy);
  const familiarity = body.comfort === 'comfort'
    ? 'prefer familiar artists or sounds'
    : body.comfort === 'exploration'
      ? 'prefer discovery, novelty, and unfamiliar artists'
      : '';
  const runtime = body.time == null ? '' : `maximum runtime around ${Number(body.time)} minutes`;

  return [
    'Recommend one album for this listener.',
    note ? `listener description: ${note}` : '',
    moods.length ? `desired emotional qualities: ${moods.join(', ')}` : '',
    avoidMoods.length ? `avoid these emotional qualities: ${avoidMoods.join(', ')}` : '',
    genres.length ? `requested genres or styles: ${genres.join(', ')}` : '',
    avoidGenres.length ? `avoid these genres or styles: ${avoidGenres.join(', ')}` : '',
    energy,
    familiarity,
    runtime,
    'Match the emotional and sonic character first. Do not reward literal word overlap when the musical vibe is wrong.',
  ].filter(Boolean).join(' ').slice(0, 1800);
}

export function normalizedVector(values) {
  const out = Float32Array.from(values || [], value => Number(value) || 0);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return out;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'q8',
      device: 'cpu',
    }).catch(error => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

export async function embedTexts(input) {
  const rows = Array.isArray(input) ? input : [input];
  if (!rows.length) return [];
  const extractor = await getExtractor();
  const output = await extractor(rows, { pooling: 'mean', normalize: true });
  const nested = output.tolist();
  return nested.map(normalizedVector);
}
