import test from 'node:test';
import assert from 'node:assert/strict';
import '../sync-state.js';
const {mergeDiary,mergeState}=globalThis.AlbumSyncState;
const record=(rating,extra={})=>({date:'2026-11-11',artist:'An Artist',album:'An Album',rating,...extra});

test('sync unions old and new seen albums without repeats',()=>{
 const merged=mergeState({seenKeys:['artist::a','artist::b']},{seenKeys:['artist::b','artist::c']});
 assert.deepEqual(merged.seenKeys,['artist::a','artist::b','artist::c']);
});
test('an older offline diary copy does not erase a newer cloud rating',()=>{
 const merged=mergeState({diary:[record(5,{updated_at:'2026-11-11T12:00:00Z'})]},
  {diary:[record(1,{updated_at:'2026-11-10T12:00:00Z'})]});
 assert.equal(merged.diary[0].rating,5);
});
test('new local edits are preserved when the cloud is older',()=>{
 const merged=mergeState({diary:[record(3,{updated_at:'2026-11-10T12:00:00Z'})]},
  {diary:[record(4,{updated_at:'2026-11-11T12:00:00Z'})]});
 assert.equal(merged.diary[0].rating,4);
});
test('deletion tombstones keep removed diaries removed across devices',()=>{
 const x=record(5);
 const merged=mergeState({diary:[x]},{deletedDiaryKeys:['2026-11-11::an artist::an album']});
 assert.equal(merged.diary.length,0);
});
test('a diary with notes is preferred over an unversioned empty copy',()=>{
 const merged=mergeDiary([record(5,{notes:'loved this'})],[record(0)],new Set());
 assert.equal(merged[0].rating,5);
});
test('recent artists, completion days and history merge rather than replace',()=>{
 const merged=mergeState({recentArtists:['A'],pickDays:['2026-11-10'],seenKeys:['a::b']},
 {recentArtists:['B'],pickDays:['2026-11-11'],seenKeys:['a::c']});
 assert.deepEqual(merged.pickDays,['2026-11-10','2026-11-11']);
 assert.deepEqual(merged.recentArtists,['a','b']);
 assert.deepEqual(merged.seenKeys,['a::b','a::c']);
});
test('remote Last.fm profile stays when local profile is absent',()=>{
 const merged=mergeState({lastfm_profile:{imported_at:'2026-11-11T12:00:00Z',artists:[['test',10]]}},{});
 assert.equal(merged.lastfmProfile.artists[0][0],'test');
});
test('local import newer than remote Last.fm profile wins',()=>{
 const merged=mergeState({lastfmProfile:{imported_at:'2026-11-09T12:00:00Z',artists:[['old',5]]}},
 {lastfmProfile:{imported_at:'2026-11-11T12:00:00Z',artists:[['new',5]]}});
 assert.equal(merged.lastfmProfile.artists[0][0],'new');
});
