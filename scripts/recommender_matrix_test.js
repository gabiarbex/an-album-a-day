#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  energyPenalty,
  genreConflict,
  moodConflict,
  scoreCandidate,
  explanation,
} from '../api/_ranking-core.js';

const baseBody = {
  energy: null,
  comfort: null,
  time: null,
  recentArtists: [],
  moods: [],
  intent: { moods: {}, avoidGenres: [], avoidMoods: {}, genres: [] },
};

const candidate = (overrides = {}) => ({
  id: overrides.id || 'candidate',
  artist: 'Test Artist',
  title: 'Test Album',
  localScore: 0.6,
  semanticScore: 0,
  familiarity: 0,
  tasteAdjacency: 0,
  profileQuality: 1,
  genres: [],
  tags: [],
  moods: [],
  energy: null,
  energyConfidence: 1,
  duration: 40,
  moodSource: 'editorial',
  energySource: 'editorial',
  ...overrides,
});

function score(c, neural, body = baseBody, taste = { score: 0, confidence: 0 }) {
  return scoreCandidate(c, neural, body, taste);
}

function wins(name, preferred, rejected, body, {
  preferredNeural = 0.55,
  rejectedNeural = 0.55,
  margin = 0.01,
  preferredTaste = { score: 0, confidence: 0 },
  rejectedTaste = { score: 0, confidence: 0 },
} = {}) {
  const a = score(preferred, preferredNeural, body, preferredTaste);
  const b = score(rejected, rejectedNeural, body, rejectedTaste);
  assert.ok(a > b + margin, `${name}: expected preferred > rejected by ${margin}; got ${a} vs ${b}`);
}

// 1. Low-energy requests must reject clearly high-energy records.
wins(
  'low energy',
  candidate({ energy: 2 }),
  candidate({ energy: 9 }),
  { ...baseBody, energy: 2 },
  { margin: 0.24 },
);

// 2. High-energy requests must reject clearly low-energy records.
wins(
  'high energy',
  candidate({ energy: 9 }),
  candidate({ energy: 2 }),
  { ...baseBody, energy: 9 },
  { margin: 0.24 },
);

// 3. Reliable avoided moods are a strong constraint.
{
  const body = { ...baseBody, intent: { ...baseBody.intent, avoidMoods: { energetic: 1 } } };
  const clean = candidate({ moods: ['reflective'], tags: ['quiet'] });
  const conflict = candidate({ moods: ['energetic'], tags: ['upbeat'] });
  assert.equal(moodConflict(conflict, ['energetic']), true);
  wins('avoid energetic mood', clean, conflict, body, { margin: 0.32 });
}

// 4. Explicit avoided genres are a strong constraint.
{
  const body = { ...baseBody, intent: { ...baseBody.intent, avoidGenres: ['metal'] } };
  const clean = candidate({ genres: ['dream pop'] });
  const conflict = candidate({ genres: ['metal', 'doom metal'] });
  assert.equal(genreConflict(conflict, ['metal']), true);
  wins('avoid metal', clean, conflict, body, { margin: 0.45 });
}

// 5. Runtime constraints must beat a clearly overlong album.
wins(
  'runtime cap',
  candidate({ duration: 27 }),
  candidate({ duration: 92 }),
  { ...baseBody, time: 30 },
  { margin: 0.34 },
);

// 6. Recent artists should not immediately repeat.
wins(
  'recent artist diversity',
  candidate({ artist: 'Fresh Artist' }),
  candidate({ artist: 'Repeated Artist' }),
  { ...baseBody, recentArtists: ['repeated artist'] },
  { margin: 0.15 },
);

// 7. Comfort mode should prefer familiar artists when other signals are equal.
wins(
  'comfort familiarity',
  candidate({ familiarity: 0.95 }),
  candidate({ familiarity: 0.05 }),
  { ...baseBody, comfort: 'comfort' },
  { margin: 0.04 },
);

// 8. Exploration should prefer unfamiliar artists when other signals are equal.
wins(
  'exploration novelty',
  candidate({ familiarity: 0.05 }),
  candidate({ familiarity: 0.95 }),
  { ...baseBody, comfort: 'exploration' },
  { margin: 0.04 },
);

// 9. Exploration should favor adjacent-but-new artists over random unfamiliar ones.
wins(
  'taste-neighbor exploration',
  candidate({ familiarity: 0, tasteAdjacency: 0.9 }),
  candidate({ familiarity: 0, tasteAdjacency: 0 }),
  { ...baseBody, comfort: 'exploration' },
  { margin: 0.06 },
);

// 10. Sparse metadata should temper an apparently stronger neural match.
wins(
  'profile reliability',
  candidate({ profileQuality: 1 }),
  candidate({ profileQuality: 0.18 }),
  baseBody,
  { preferredNeural: 0.50, rejectedNeural: 0.72, margin: 0 },
);

// 11. Learned listener taste must materially separate otherwise equal records.
wins(
  'learned taste',
  candidate({}),
  candidate({}),
  baseBody,
  {
    preferredTaste: { score: 0.8, confidence: 0.8 },
    rejectedTaste: { score: -0.8, confidence: 0.8 },
    margin: 0.10,
  },
);

// 12. A forbidden genre must still lose even with a much better neural score.
wins(
  'hard avoid beats neural advantage',
  candidate({ genres: ['dream pop'] }),
  candidate({ genres: ['metal'] }),
  { ...baseBody, intent: { ...baseBody.intent, avoidGenres: ['metal'] } },
  { preferredNeural: 0.45, rejectedNeural: 0.85, margin: 0.30 },
);

// 13. A severe runtime violation must still lose with a better neural score.
wins(
  'runtime beats neural advantage',
  candidate({ duration: 28 }),
  candidate({ duration: 110 }),
  { ...baseBody, time: 30 },
  { preferredNeural: 0.45, rejectedNeural: 0.85, margin: 0.20 },
);

// 14. A recent artist should lose a moderate neural advantage.
wins(
  'diversity beats moderate neural advantage',
  candidate({ artist: 'Fresh Artist' }),
  candidate({ artist: 'Repeated Artist' }),
  { ...baseBody, recentArtists: ['repeated artist'] },
  { preferredNeural: 0.50, rejectedNeural: 0.72, margin: 0.02 },
);

// 15. Weak translated MusicBrainz energy guesses must not act like measured energy.
{
  const body = { ...baseBody, energy: 2 };
  const guessed = candidate({
    energy: 9,
    energySource: 'musicbrainz-tag-translation',
    energyConfidence: 0.35,
  });
  assert.equal(energyPenalty(guessed, body), 0);
}

// 16. Weak translated mood guesses alone must not become hard ground truth.
{
  const guessed = candidate({
    moods: ['energetic'],
    moodSource: 'musicbrainz-tag-translation',
  });
  assert.equal(moodConflict(guessed, ['energetic']), false);
}

// 17. An explicitly requested genre should beat a large neural advantage from the wrong genre.
wins(
  'requested genre beats neural advantage',
  candidate({ genres: ['dream pop'] }),
  candidate({ genres: ['metal'] }),
  { ...baseBody, intent: { ...baseBody.intent, genres: ['dream pop'] } },
  { preferredNeural: 0.45, rejectedNeural: 0.85, margin: 0.08 },
);

// 18. Reliable requested mood evidence should beat a large neural advantage from the wrong mood.
wins(
  'requested mood beats neural advantage',
  candidate({ moods: ['melancholic'] }),
  candidate({ moods: ['energetic'] }),
  { ...baseBody, moods: ['melancholic'], intent: { ...baseBody.intent, moods: { melancholic: 1 } } },
  { preferredNeural: 0.45, rejectedNeural: 0.85, margin: 0.02 },
);

// 19. Learned taste is a prior and must not overpower an explicit genre request.
wins(
  'taste prior cannot override requested genre',
  candidate({ genres: ['jazz'] }),
  candidate({ genres: ['metal'] }),
  { ...baseBody, intent: { ...baseBody.intent, genres: ['jazz'] } },
  {
    preferredNeural: 0.50,
    rejectedNeural: 0.62,
    preferredTaste: { score: -0.2, confidence: 0.9 },
    rejectedTaste: { score: 0.9, confidence: 0.9 },
    margin: 0.02,
  },
);

// 20. Explanations must not claim a requested mood without candidate evidence.
{
  const body = { ...baseBody, moods: ['melancholic'], intent: { ...baseBody.intent, moods: { melancholic: 1 } } };
  const row = { candidate: candidate({ moods: ['energetic'] }), taste: { score: 0, confidence: 0 } };
  assert.equal(explanation(row, body).includes('melancholic'), false);
}

console.log('recommender stress matrix passed (20 release gates)');
