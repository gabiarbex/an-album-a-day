// Intent benchmark: deterministic checks for 100 multilingual prompts.
// This is an intent-parsing benchmark, NOT a human-rated album relevance score.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../intent-core.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../benchmarks/intent-100.json'),'utf8'));
const {interpretFeeling,retrievalText}=globalThis.AlbumIntent;
assert.equal(fixture.cases.length,100);
const failures=[];
const byCategory={};
for(const row of fixture.cases){
 const intent=interpretFeeling(row.prompt),query=retrievalText(row.prompt);
 const actual={
  wantGenres:intent.genres,avoidGenres:intent.avoidGenres,
  wantMoods:Object.keys(intent.moods),avoidMoods:Object.keys(intent.avoidMoods)
 };
 const errors=[];
 for(const field of ['wantGenres','avoidGenres','wantMoods','avoidMoods']){
  for(const expected of row[field]){
   if(!actual[field].includes(expected))errors.push(field+': missing '+expected);
  }
 }
 for(const word of row.avoidGenres){
  if(query.includes(word))errors.push('retrieval leaks excluded genre '+word);
 }
 for(const word of row.avoidMoods){
  if(query.includes(word))errors.push('retrieval leaks excluded mood '+word);
 }
 if(!query && (row.wantGenres.length||row.wantMoods.length))errors.push('positive query became empty');
 byCategory[row.category]??={passed:0,total:0};
 byCategory[row.category].total++;
 if(errors.length)failures.push({id:row.id,prompt:row.prompt,errors,query,actual});
 else byCategory[row.category].passed++;
}
console.log(JSON.stringify({total:fixture.cases.length,passed:fixture.cases.length-failures.length,byCategory,failures},null,2));
assert.equal(failures.length,0,'Intent benchmark failed; inspect cases above');
