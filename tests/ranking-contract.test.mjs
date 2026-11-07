import assert from 'node:assert/strict';
import {scoreCandidate,genreConflict,moodConflict,isCompilation,diverseTopK,explanation} from '../api/_ranking-core.js';

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

// Compilation-heavy catalogs must not crowd out comparable artist albums.
const solo={...base,artist:'Miles Davis',title:'In a Silent Way'};
const collection={...solo,artist:'Various Artists',title:'Ultimate Collection'};
assert.equal(isCompilation(collection),true);
assert.equal(isCompilation(solo),false);
const compilationBody={...neutral,note:'I want jazz'};
const soloScore=scoreCandidate(solo,0.7,compilationBody);
const compilationScore=scoreCandidate(collection,0.7,compilationBody);
assert.ok(soloScore>compilationScore+0.2,'Comparable artist albums should outrank various-artist compilations');
assert.ok(scoreCandidate(collection,0.7,{...compilationBody,note:'Give me a jazz compilation'})>compilationScore+0.2,
 'Compilation requests should preserve compilation eligibility');

// The strongest album stays first. Later slots avoid repeating the same artist.
const diverse=diverseTopK([
 {score:0.95,candidate:solo},
 {score:0.93,candidate:{...solo,id:'two',title:'Second Album'}},
 {score:0.90,candidate:{...solo,id:'three',artist:'John Coltrane',title:'Blue Train'}}
],3,()=>0);
assert.equal(diverse[0].candidate.artist,'Miles Davis');
assert.equal(diverse[1].candidate.artist,'John Coltrane');
assert.equal(diverse.length,3);

// Unknown mood data must not be disguised as a confirmed emotional match.
const untagged={...solo,moods:[],tags:[],moodSource:'unknown'};
const why=explanation({candidate:untagged,taste:{}},
 {...neutral,intent:{moods:{dreamy:1},genres:[],avoidGenres:[],avoidMoods:{}}});
assert.match(why,/mood tags not verified/);
assert.doesNotMatch(why,/overall match/i);


// Multi-disc collections must not masquerade as ordinary album releases.
const box={...solo,title:'10 CD Collection, 21 Original Albums: Milestones'};
assert.equal(isCompilation(box),true);
assert.ok(scoreCandidate(solo,0.7,compilationBody)>scoreCandidate(box,0.7,compilationBody)+0.2);

// Genre clues can weakly support a mood without inventing verified mood tags.
const dreamStyle={...untagged,genres:['dream pop','ethereal wave']};
const grittyStyle={...untagged,genres:['noise rock'],moods:['gritty'],moodSource:'editorial'};
const dreamyRequest={...neutral,intent:{moods:{dreamy:1},genres:[],avoidGenres:[],avoidMoods:{}}};
assert.ok(scoreCandidate(dreamStyle,0.5,dreamyRequest)>scoreCandidate(grittyStyle,0.5,dreamyRequest),
 'Well-supported dreamy styles should outrank confidently unrelated tags');
assert.match(explanation({candidate:dreamStyle,taste:{}},dreamyRequest),/not independently verified/);

console.log('Ranking safety contracts passed.');
