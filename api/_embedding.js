import path from 'node:path';
import { env, LogLevel, pipeline } from '@huggingface/transformers';

export const EMBEDDING_MODEL = process.env.ALBUM_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;
export const PROFILE_VERSION = 'album-profile-v4-minilm-clean';
export const MAX_PROFILE_TEXT = 900;

const BUNDLED_MODEL_ROOT = path.join(process.cwd(), 'models') + path.sep;
const PREFER_BUNDLED_MODEL = process.env.VERCEL === '1' || process.env.ALBUM_LOCAL_MODEL === '1';

env.allowLocalModels = true;
env.localModelPath = BUNDLED_MODEL_ROOT;
env.allowRemoteModels = !PREFER_BUNDLED_MODEL;
env.useFSCache = !PREFER_BUNDLED_MODEL;
env.cacheDir = PREFER_BUNDLED_MODEL ? null : '/tmp/album-a-day-transformers-cache';
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
  const energySource = String(album.energySource || album.provenance?.energy?.source || '');
  const translatedEnergyGuess = energySource === 'musicbrainz-tag-translation';
  const energy = [
    album._acoustic?.energy,
    album._live?.signals?.energy,
    translatedEnergyGuess ? null : (album.features?.energy != null ? Number(album.features.energy) * 10 : null),
    translatedEnergyGuess ? null : album.energy_level,
    translatedEnergyGuess ? null : album.energy,
  ].find(value => value !== null && value !== undefined && Number.isFinite(Number(value)));

  return [
    `artist: ${String(album.artist || '').slice(0, 140)}`,
    `album: ${String(album.title || '').slice(0, 180)}`,
    year ? `released: ${year}` : '',
    decade ? `era: ${decade}` : '',
    genres.length ? `genres and styles: ${genres.join(', ')}` : '',
    tags.length ? `descriptive music tags: ${tags.join(', ')}` : '',
    moods.length ? `catalog mood tags: ${moods.join(', ')}` : '',
    album.originCountry ? `artist associated with country: ${({BR:'Brazil',NL:'Netherlands',PT:'Portugal',BE:'Belgium',DE:'Germany',FR:'France',ES:'Spain',JP:'Japan',AR:'Argentina',NG:'Nigeria',UA:'Ukraine'})[album.originCountry]||album.originCountry}` : '',
    Array.isArray(album.vocalLanguages)&&album.vocalLanguages.length ? `verified sung languages: ${album.vocalLanguages.join(', ')}` : '',
    featureMoods.length ? `estimated emotional qualities: ${featureMoods.join(', ')}` : '',
    energy === undefined ? '' : energyLabel(Number(energy)),
    duration === undefined ? '' : `runtime: about ${Math.round(Number(duration))} minutes`,
    'Represent the sound, emotional character, atmosphere, intensity, and listening context of this record.',
  ].filter(Boolean).join('. ').slice(0, MAX_PROFILE_TEXT);
}

export function queryProfile(body) {
  const note = String(body.retrievalNote ?? body.note ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000);
  const moods = cleanArray(body.moods, 24);

  const genres = cleanArray(body.intent?.genres, 12);
  const requestedCountries = cleanArray(body.intent?.originCountries, 12).map(code=>({
   BR:'Brazilian artists',NL:'Dutch artists',PT:'Portuguese artists',BE:'Belgian artists',DE:'German artists',
   FR:'French artists',ES:'Spanish artists',JP:'Japanese artists',AR:'Argentinian artists',NG:'Nigerian artists',UA:'Ukrainian artists'
  })[code]||'');
  const requestedVocals = cleanArray(body.intent?.vocalLanguages, 12);

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

    genres.length ? `requested genres or styles: ${genres.join(', ')}` : '',
    requestedCountries.length ? `artist origins: ${requestedCountries.join(', ')}` : '',
    requestedVocals.length ? `requested sung languages (unverified unless tagged): ${requestedVocals.join(', ')}` : '',

    energy,
    familiarity,
    runtime,
    'Find music consistent with these positive sonic characteristics.',
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

async function createExtractor() {
  try {
    return await pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'q8',
      device: 'cpu',
      local_files_only: PREFER_BUNDLED_MODEL,
    });
  } catch (error) {
    if (!PREFER_BUNDLED_MODEL) throw error;
    console.warn('bundled_embedding_model_unavailable_falling_back_remote', String(error?.message || error).slice(0, 240));
    env.allowRemoteModels = true;
    env.useFSCache = true;
    env.cacheDir = '/tmp/album-a-day-transformers-cache';
    return pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'q8',
      device: 'cpu',
    });
  }
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = createExtractor().catch(error => {
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
