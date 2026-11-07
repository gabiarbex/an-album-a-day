import assert from 'node:assert/strict';
import {scoreCandidate,genreConflict,moodConflict} from '../api/_ranking-core.js';

// Controlled fixtures isolate the reranker; these are not claims about real albums.
const base={
 id:'fixture',artist:'Test Artist',genres:['jazz'],tags:['jazz'],moods:['warm'],
 moodSource:'editorial',energy:3,energySource:'audio',energyConfidence:1,
 localScore:0.5,semanticScore:0,profileQuality:1, familiarity:0.1
};
const body={
 note:'jazz but not metal',moods:[],comfort:null,energy:null,time:null,recentArtists:[],
 intent:{genres:['jazz'],avoidGenres:['metal'],moods:{},avoidMoods:{}}
};
const relevant={...base,id:'jazz'};
const excluded={...base,id:'metal',genres:['metal'],tags:['metal']};
assert.equal(genreConflict(excluded,['metal']),true);
assert.ok(scoreCandidate(relevant,0.4,body)>scoreCandidate(excluded,0.95,body),
 'An explicitly excluded genre must lose even with better neural similarity');
const moodBody={...body,intent:{genres:[],avoidGenres:[],moods:{warm:1},avoidMoods:{dark:1}}};
const forbiddenMood={...base,moods:['dark'],tags:['dark']};
assert.equal(moodConflict(forbiddenMood,['dark']),true);
assert.ok(scoreCandidate(base,0.3,moodBody)>scoreCandidate(forbiddenMood,0.95,moodBody),
 'Explicitly avoided moods must be penalized');
const neutral={...body,intent:{genres:[],avoidGenres:[],moods:{},avoidMoods:{}},energy:null};
assert.ok(Number.isFinite(scoreCandidate(base,0.5,neutral)));
assert.equal(genreConflict({...base,genres:[],tags:[]},['metal']),false,
 'Missing metadata must not be treated as proof of conflict');
console.log('Ranking safety contracts passed.');
