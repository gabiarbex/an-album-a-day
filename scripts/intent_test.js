#!/usr/bin/env node
'use strict';

require('../intent-core.js');
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

console.log('Intent parser regression tests passed.');
