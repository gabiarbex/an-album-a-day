import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateAllowed,eligibleRanked} from '../api/_eligibility.js';
import {scoreCandidate} from '../api/_ranking-core.js';

const c=(id,extra={})=>({id,artist:'An Artist',title:'Record',genres:['indie folk'],tags:['reflective'],moods:['reflective'],originCountry:'BR',vocalLanguages:['pt'],duration:34,...extra});
const ranked=(...albums)=>albums.map((candidate,i)=>({candidate,score:1-i*.01,neural:0,taste:{score:0,confidence:0}}));

test('no rock means no rock even when the rock candidate scores highest',()=>{
 const result=eligibleRanked(ranked(c('wrong',{genres:['rock']}),c('right')),{intent:{avoidGenres:['rock']}});
 assert.deepEqual(result.eligible.map(row=>row.candidate.id),['right']);
});
test('never restore excluded genres when every candidate conflicts',()=>{
 const result=eligibleRanked(ranked(c('one',{genres:['metal']}),c('two',{genres:['black metal']})),{intent:{avoidGenres:['metal']}});
 assert.equal(result.eligible.length,0);
 assert.equal(result.reason,'excluded');
});
test('unknown genre is not considered safe for an exclusion',()=>{
 assert.equal(candidateAllowed(c('x',{genres:[],tags:[]}),{avoidGenres:['rock']}),false);
});
test('country origin is explicit, not inferred from the lyric language',()=>{
 const result=eligibleRanked(ranked(c('pt',{originCountry:'PT'}),c('br',{originCountry:'BR'})),{intent:{originCountries:['BR']}});
 assert.equal(result.eligible[0].candidate.id,'br');
});
test('unknown origin does not satisfy a country request',()=>{
 const result=eligibleRanked(ranked(c('unknown',{originCountry:null})),{intent:{originCountries:['NL']}});
 assert.equal(result.reason,'country');
});
test('origin exclusions cannot be overruled by high scores',()=>{
 const result=eligibleRanked(ranked(c('excluded',{originCountry:'NL'}),c('safe')),{intent:{avoidOriginCountries:['NL']}});
 assert.equal(result.eligible[0].candidate.id,'safe');
});
test('explicit language requests only accept verified vocal language',()=>{
 const result=eligibleRanked(ranked(c('same origin but unknown',{vocalLanguages:[]}),c('correct',{vocalLanguages:['en']})),{intent:{vocalLanguages:['en']}});
 assert.equal(result.eligible[0].candidate.id,'correct');
});
test('the language of an artist is not proof of sung language',()=>{
 const result=eligibleRanked(ranked(c('Brazilian',{originCountry:'BR',vocalLanguages:[]})),{intent:{vocalLanguages:['pt']}});
 assert.equal(result.reason,'vocal-language');
});
test('unknown vocal language cannot satisfy an explicit vocal exclusion',()=>{
 assert.equal(candidateAllowed(c('unknown',{vocalLanguages:[]}),{avoidVocalLanguages:['en']}),false);
});
test('positive country and vocal requirements are conjunctive',()=>{
 const result=eligibleRanked(ranked(c('wrong country',{originCountry:'PT',vocalLanguages:['pt']}),c('wrong vocal',{originCountry:'BR',vocalLanguages:['en']})),{intent:{originCountries:['BR'],vocalLanguages:['pt']}});
 assert.equal(result.reason,'vocal-language');
});
test('hard runtime limit excludes an album that is too long',()=>{
 const result=eligibleRanked(ranked(c('long',{duration:95}),c('fits',{duration:32})),{time:35,intent:{}});
 assert.deepEqual(result.eligible.map(r=>r.candidate.id),['fits']);
});
test('requested reflective mood excludes a known avoided mood',()=>{
 const result=eligibleRanked(ranked(c('dark',{moods:['energetic'],tags:['energetic']}),c('soft')),{intent:{avoidMoods:{energetic:1}}});
 assert.equal(result.eligible[0].candidate.id,'soft');
});
test('personal taste does not override a forbidden genre',()=>{
 const wrong=c('wrong',{genres:['hardcore punk'],localScore:1});
 const good=c('good',{genres:['ambient'],localScore:0.3});
 const body={intent:{avoidGenres:['hardcore punk']}};
 assert.equal(eligibleRanked(ranked(wrong,good),body).eligible[0].candidate.id,'good');
});
test('neural ranking remains finite with multilingual intent',()=>{
 const value=scoreCandidate(c('test'),0.45,{note:'quero musica brasileira calma, sem rock',intent:{moods:{calm:2},avoidGenres:['rock'],originCountries:['BR']},energy:3}, {score:0,confidence:0});
 assert.ok(Number.isFinite(value));
});