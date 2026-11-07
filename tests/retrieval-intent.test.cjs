// Run with: node tests/retrieval-intent.test.cjs
const assert=require('node:assert/strict');
require('../intent-core.js');
const {interpretFeeling,retrievalText}=globalThis.AlbumIntent;
const cases=[
 ['I want jazz, not metal','jazz','metal'],
 ['I miss someone but I do not want sad music','miss someone','sad'],
 ['quero bossa nova, sem rock','bossa nova','rock'],
 ['no techno, give me ambient','ambient','techno'],
 ['I want dreamy music without angry vocals','dreamy','angry'],
 ['nao quero metal; quero samba','samba','metal']
];
for(const [prompt,wanted,excluded] of cases){
 const query=retrievalText(prompt);
 assert.ok(query.includes(wanted),JSON.stringify({prompt,query,wanted}));
 assert.ok(!query.includes(excluded),JSON.stringify({prompt,query,excluded}));
}
assert.equal(retrievalText('not metal'),'');
assert.ok(interpretFeeling('I want jazz, not metal').avoidGenres.includes('metal'));
assert.ok(interpretFeeling('quero bossa nova, sem rock').avoidGenres.includes('rock'));
assert.ok(interpretFeeling('I miss someone but I do not want sad music').avoidMoods.melancholic>0);
console.log('Retrieval exclusions and multilingual intent cases passed.');
