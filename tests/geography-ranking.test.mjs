import assert from 'node:assert/strict';
import fs from 'node:fs';
import {geographyFit,scoreCandidate,explanation,plausibleVocalOrigin} from '../api/_ranking-core.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../data/geography/manifest.json',import.meta.url),'utf8'));
const data=code=>JSON.parse(fs.readFileSync(new URL('../data/geography/'+code+'.json',import.meta.url),'utf8'));
assert.equal(manifest.does_not_infer_vocal_language,true);
for(const code of ['BR','NL']){
 const rows=data(code).entries;
 assert.ok(rows.length>=30,code+' needs substantial actual catalog coverage');
 assert.equal(rows.length,manifest.country_counts[code].indexed_albums);
 assert.ok(rows.every(a=>a._originCountry===code&&a._originSource==='curated-artist-area-v1'));
 assert.ok(rows.every(a=>a.lookup_id&&a._catalogFile&&a.artist&&a.title));
 assert.ok(rows.every(a=>!a.vocalLanguages),'Artist origin must not create fake lyric language');
}
const candidate=(originCountry,styles=['jazz'])=>({
 artist:'Fixture',title:'Fixture',genres:styles,tags:styles,originCountry,
 localScore:.5,semanticScore:0,profileQuality:1
});
const body={note:'Brazilian jazz',moods:[],energy:null,time:null,comfort:null,recentArtists:[],
 intent:{originCountries:['BR'],avoidOriginCountries:['NL'],vocalLanguages:[],genres:['jazz'],avoidGenres:[],moods:{},avoidMoods:{}}};
const brazil=candidate('BR'),dutch=candidate('NL'),unknown=candidate(null);
assert.ok(scoreCandidate(brazil,.4,body)>scoreCandidate(dutch,.9,body));
assert.ok(scoreCandidate(brazil,.4,body)>scoreCandidate(unknown,.9,body));
assert.equal(geographyFit(brazil,body).countryMatch,true);
assert.equal(geographyFit(dutch,body).excludedCountry,true);
assert.match(explanation({candidate:brazil,taste:{}},body),/Brazil/);
const singing={...body,intent:{...body.intent,vocalLanguages:['nl']}};
assert.match(explanation({candidate:brazil,taste:{}},singing),/cannot verify the language sung/);
assert.equal(geographyFit(brazil,singing).vocalMatch,false);
const verified={...brazil,vocalLanguages:['nl']};
assert.equal(geographyFit(verified,singing).vocalMatch,true);

// Country association is only a fallback hint when lyrics are unknown.
const dutchLyrics={...body,intent:{...body.intent,originCountries:[],avoidOriginCountries:[],vocalLanguages:['nl']}};
assert.equal(plausibleVocalOrigin(dutch,dutchLyrics),true);
assert.equal(plausibleVocalOrigin(brazil,dutchLyrics),false);
assert.equal(plausibleVocalOrigin(unknown,dutchLyrics),false);
assert.equal(geographyFit(dutch,dutchLyrics).vocalMatch,false,
 'Dutch origin must not be presented as proof of Dutch vocals');
assert.match(explanation({candidate:dutch,taste:{}},dutchLyrics),/cannot verify the language sung/);
assert.ok(scoreCandidate(dutch,.4,dutchLyrics)>scoreCandidate(unknown,.4,dutchLyrics));

console.log('Artist-origin index and genre-vs-vocal-language evidence contracts passed.');
