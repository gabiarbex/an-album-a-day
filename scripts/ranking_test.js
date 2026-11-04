import assert from 'node:assert/strict';
import { energyPenalty, moodConflict, scoreCandidate } from '../api/_ranking-core.js';

const baseBody = {
  energy: null,
  comfort: null,
  time: null,
  recentArtists: [],
  intent: { avoidGenres: [], avoidMoods: {} },
};

const candidate = overrides => ({
  artist: 'Test Artist',
  localScore: 0.6,
  semanticScore: 0,
  familiarity: 0,
  tasteAdjacency: 0,
  genres: [],
  tags: [],
  moods: [],
  energy: null,
  energyConfidence: 1,
  duration: 40,
  ...overrides,
});

// Low-energy intent must prefer genuinely low-energy music when neural fit is equal.
{
  const body = { ...baseBody, energy: 2 };
  const calm = scoreCandidate(candidate({ energy: 2 }), 0.55, body);
  const upbeat = scoreCandidate(candidate({ energy: 9 }), 0.55, body);
  assert.ok(calm > upbeat + 0.2, `expected calm > upbeat, got ${calm} vs ${upbeat}`);
}

// Weak MusicBrainz genre-to-energy guesses are not evidence.
{
  const body = { ...baseBody, energy: 2 };
  const guessed = candidate({
    energy: 9,
    energySource: 'musicbrainz-tag-translation',
    energyConfidence: 0.35,
  });
  assert.equal(energyPenalty(guessed, body), 0);
}

// Reliable avoided moods should be penalized.
{
  const body = { ...baseBody, intent: { avoidGenres: [], avoidMoods: { energetic: 1 } } };
  const reliable = candidate({ moods: ['energetic'], moodSource: 'editorial' });
  const neutral = candidate({ moods: ['reflective'], moodSource: 'editorial' });
  assert.ok(
    scoreCandidate(neutral, 0.5, body) > scoreCandidate(reliable, 0.5, body) + 0.3,
    'reliable avoided mood should materially lower score',
  );
  assert.equal(moodConflict(reliable, ['energetic']), true);
}

// Translated genre moods must not become ground truth.
{
  const translated = candidate({
    moods: ['energetic'],
    moodSource: 'musicbrainz-tag-translation',
  });
  assert.equal(moodConflict(translated, ['energetic']), false);
}

// Exploration should reward adjacent-but-new artists.
{
  const body = { ...baseBody, comfort: 'exploration' };
  const adjacent = candidate({ familiarity: 0, tasteAdjacency: 0.9 });
  const random = candidate({ familiarity: 0, tasteAdjacency: 0 });
  assert.ok(
    scoreCandidate(adjacent, 0.5, body) > scoreCandidate(random, 0.5, body) + 0.05,
    'taste adjacency should help exploration',
  );
}

// Learned positive/negative taste should move otherwise equal records apart.
{
  const liked = scoreCandidate(candidate({}), 0.5, baseBody, { score: 0.8, confidence: 0.8 });
  const disliked = scoreCandidate(candidate({}), 0.5, baseBody, { score: -0.8, confidence: 0.8 });
  assert.ok(liked > disliked + 0.15, 'learned taste should materially affect ranking');
}

// Runtime constraint should matter.
{
  const body = { ...baseBody, time: 30 };
  const short = scoreCandidate(candidate({ duration: 28 }), 0.5, body);
  const long = scoreCandidate(candidate({ duration: 85 }), 0.5, body);
  assert.ok(short > long + 0.2, 'runtime overflow should lower ranking');
}

console.log('ranking regression tests passed');
