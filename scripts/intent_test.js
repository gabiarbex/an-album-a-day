#!/usr/bin/env node
'use strict';

await import('../intent-core.js');
const {interpretFeeling}=globalThis.AlbumIntent;
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};

let x=interpretFeeling("i miss my girlfriend but i don't want a sad record. something warm and a little weird.");
assert(x.moods.warm>0,'relationship longing should read warm');
assert(x.moods.nostalgic>0,'relationship longing should read nostalgic');
assert(!x.moods.melancholic,'negated sad must not remain a positive melancholic cue');
assert(x.avoidMoods.melancholic>0,'negated sad should become an avoid cue');
assert(x.exploration===1,'weird should request exploration');

x=interpretFeeling('shoegaze, but no metal. dreamy and cold.');
assert(x.genres.includes('shoegaze'),'shoegaze genre should be requested');
assert(x.avoidGenres.includes('metal'),'metal should be avoided');
assert(x.moods.dreamy>0,'dreamy mood should be recognized');
assert(x.moods.cold>0,'cold mood should be recognized');

x=interpretFeeling('saudade dela, algo quente, sem tristeza');
assert(x.moods.nostalgic>0,'Portuguese saudade should be nostalgic');
assert(x.moods.warm>0,'Portuguese relationship longing should become warm');
assert(x.avoidMoods.melancholic>0,'Portuguese sem tristeza should avoid melancholic');

x=interpretFeeling('quero algo fora do óbvio e diferente');
assert(x.exploration===1,'Portuguese exploration cues should work');

x=interpretFeeling('quiet, intimate, melancholy, a little homesick, not upbeat');
assert(x.moods.melancholic>0,'melancholy should be recognized');
assert(x.moods.nostalgic>0,'homesick should be nostalgic');
assert(x.moods.warm>0,'intimate should become warm');
assert(x.avoidMoods.energetic>0,'not upbeat must become an energetic avoid cue');
assert(x.energy===3,'quiet/intimate should imply low energy without negation leakage');

x=interpretFeeling('upbeat, lively, something for dancing');
assert(x.moods.energetic>0,'upbeat/lively should be energetic');
assert(x.energy===8,'upbeat/lively should imply high energy');

x=interpretFeeling('not high energy, something soft and restrained');
assert(x.avoidMoods.energetic>0,'not high energy must become an energetic avoid cue');
assert(x.energy===3,'soft/restrained should imply low energy');

x=interpretFeeling('não quero nada animado, algo calmo');
assert(x.avoidMoods.energetic>0,'Portuguese negated lively cue should avoid energetic');
assert(x.energy===3,'Portuguese calm request should imply low energy');

console.log('Intent parser regression tests passed.');
