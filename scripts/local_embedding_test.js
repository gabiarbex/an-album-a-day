process.env.VERCEL = '1';
process.env.ALBUM_LOCAL_MODEL = '1';

const { embedTexts, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = await import('../api/_embedding.js');

const started = performance.now();
const vectors = await embedTexts([
  'quiet, intimate, melancholy, reflective, low energy',
]);
const elapsed = (performance.now() - started) / 1000;

if (!Array.isArray(vectors) || vectors.length !== 1) {
  throw new Error('Expected exactly one embedding.');
}
if (vectors[0].length !== EMBEDDING_DIMENSIONS) {
  throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vectors[0].length}`);
}
const norm = Math.sqrt([...vectors[0]].reduce((sum, value) => sum + value * value, 0));
if (Math.abs(norm - 1) > 0.02) {
  throw new Error(`Expected normalized embedding, got norm ${norm}`);
}

console.log(JSON.stringify({
  ok: true,
  model: EMBEDDING_MODEL,
  dimensions: vectors[0].length,
  norm: Number(norm.toFixed(6)),
  elapsedSeconds: Number(elapsed.toFixed(3)),
}));
