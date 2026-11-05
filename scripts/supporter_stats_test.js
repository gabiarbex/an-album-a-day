import assert from 'node:assert/strict';
await import('../supporter-core.js');
const Core=globalThis.AlbumSupporterCore;

const state={
  diary:[
    {date:'2026-01-03',artist:'HAIM',album:'Women in Music Pt. III',rating:5,genre:'indie rock',favorite_track:'The Steps',duration_min:51,signal_snapshot:{moods:{warm:.8,energetic:.4},energy:7}},
    {date:'2026-01-04',artist:'HAIM',album:'I quit',rating:4,genre:'indie rock',favorite_track:'The Steps',duration_min:43,signal_snapshot:{moods:{warm:.6},energy:.6}},
    {date:'2026-02-10',artist:'Alice Merton',album:'S.I.D.E.S.',rating:5,genre:'alternative',favorite_track:'Same Team',duration_min:39,signal_snapshot:{moods:{intense:.7,reflective:.5},energy:8}},
    {date:'2025-12-31',artist:'Test Artist',album:'Old Year',rating:3,genre:'folk',favorite_track:'Old Song',duration_min:30,signal_snapshot:{moods:{nostalgic:1},energy:3}}
  ],
  seenKeys:['a','b','c','d','e'],
  pickDays:['2026-01-03','2026-01-04','2026-02-10','2025-12-31'],
  lastfmProfile:{total_scrobbles:1234,unique_artists:88,neighbors:[['Neighbor',1]]}
};

const all=Core.buildStats(state,null,new Date('2026-02-10T12:00:00Z'));
assert.equal(all.saved,4);
assert.equal(all.pulled,5);
assert.equal(all.uniqueArtists,3);
assert.equal(all.fiveStar,2);
assert.equal(all.topArtists[0].name,'HAIM');
assert.equal(all.topArtists[0].count,2);
assert.equal(all.favoriteTracks[0].name,'The Steps');
assert.equal(all.listeningMinutes,163);
assert.equal(all.lastfmScrobbles,1234);
assert.equal(all.longestStreak,2);

const y=Core.buildStats(state,2026);
assert.equal(y.saved,3);
assert.equal(y.daysPicked,3);
assert.equal(y.topGenres[0].name,'indie rock');
assert.equal(y.biggestMonth.name,'1');
assert.equal(y.topRated.rating,5);
assert.match(Core.wrappedSummary(y),/2026/);
assert.deepEqual(Core.availableYears(state,new Date('2026-02-10T12:00:00Z')),[2026,2025]);
assert.equal(Core.hoursLabel(163),'2.7 hr');

console.log('PASS supporter analytics');