import test from 'node:test';
import assert from 'node:assert/strict';
import '../album-locale.js';
import '../intent-core.js';
const parse=globalThis.AlbumLocale.parse;
const interpret=globalThis.AlbumIntent.interpretFeeling;
const cases=[
 ['Portuguese country','I want Portuguese records','PT',null],
 ['Portuguese vocals','I want songs sung in Portuguese',null,'pt'],
 ['Brazilian artist','quero discos brasileiros','BR',null],
 ['Brazilian sung in English','música brasileira em inglês','BR','en'],
 ['Dutch country','ik wil een Nederlandse plaat','NL',null],
 ['Dutch vocals','ik wil muziek in het Nederlands',null,'nl'],
 ['German country','Ich will deutsche Musik','DE',null],
 ['German vocals','Musik auf Deutsch',null,'de'],
 ['French country','je veux de la musique française','FR',null],
 ['Spanish vocals','quiero música en español',null,'es'],
 ['Japanese country','Japanese records','JP',null],
 ['Ukrainian country','хочу українська музика','UA',null],
 ['Ukrainian vocals','хочу музику українською',null,'uk'],
 ['Portuguese Brazil with Portuguese vocals','quero música brasileira em português','BR','pt'],
 ['Dutch in Portuguese','Dutch music sung in Portuguese','NL','pt'],
 ['German in English','German bands singing in English','DE','en'],
 ['Portuguese from Portugal','albums from Portugal','PT',null],
 ['Ukraine in English','Ukrainian artists singing in English','UA','en']
];
for(const [name,input,country,vocal] of cases){
 test(name,()=>{
  const result=parse(input);
  if(country)assert.ok(result.originCountries.includes(country),JSON.stringify(result));
  if(vocal)assert.ok(result.vocalLanguages.includes(vocal),JSON.stringify(result));
 });
}
test('country and vocal language are separate',()=>{
 const p=parse('music in Portuguese');
 assert.ok(p.vocalLanguages.includes('pt'));
 assert.ok(!p.originCountries.includes('PT'));
});
test('Dutch music without Dutch lyrics can be distinguished',()=>{
 const p=parse('Dutch artists with no vocals in Dutch');
 assert.ok(p.originCountries.includes('NL'));
 assert.ok(p.avoidVocalLanguages.includes('nl'));
});
test('do not confuse listening language with album origin',()=>{
 const p=parse('quero um álbum brasileiro');
 assert.equal(p.queryLanguage,'pt');
 assert.ok(p.originCountries.includes('BR'));
});
test('Portuguese explicit genre exclusion is preserved',()=>{
 const p=interpret('quero um álbum brasileiro calmo, sem rock');
 assert.ok(p.originCountries.includes('BR'));
 assert.ok(p.avoidGenres.includes('rock'));
});
test('Dutch genre negation remains negative after translation',()=>{
 const p=interpret('ik wil rustige nederlandse muziek zonder techno');
 assert.ok(p.originCountries.includes('NL'));
 assert.ok(p.avoidGenres.includes('techno'));
});
test('German negation remains negative after translation',()=>{
 const p=interpret('ich will ruhige musik ohne metal');
 assert.ok(p.avoidGenres.includes('metal'));
});
test('emotional conflict does not imply an upbeat record',()=>{
 const p=interpret('I had a terrible fight with my girlfriend and I do not know if we have a future');
 assert.equal(p.narrativeKind,'relationship-uncertainty');
 assert.ok(!p.moods.hopeful);
});
test('explicit happy musical outcome overrides a sad personal situation',()=>{
 const p=interpret('I feel sad but I want upbeat dance music');
 assert.ok(p.goalShift);
 assert.ok(p.moods.energetic);
});

test('indie folk is a distinct compound genre',()=>{
 const p=interpret('I want quiet indie folk, not metal');
 assert.ok(p.genres.includes('indie folk'));
 assert.ok(!p.genres.includes('indie'));
 assert.ok(!p.genres.includes('folk'));
 assert.ok(p.avoidGenres.includes('metal'));
});
test('relationship uncertainty remains relevant when a listener asks for reflective music',()=>{
 const p=interpret('I had a terrible fight with my girlfriend and I am scared of losing her, I want reflective indie folk music');
 assert.equal(p.narrativeKind,'relationship-uncertainty');
 assert.ok(p.genres.includes('indie folk'));
});
