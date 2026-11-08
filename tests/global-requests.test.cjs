const assert=require('node:assert/strict');
require('../album-locale.js');
require('../intent-core.js');
const {interpretFeeling,retrievalText}=globalThis.AlbumIntent;
const cases=[
 {text:'quero um álbum brasileiro de samba, sem metal',language:'pt',country:'BR',genre:'samba',avoidGenre:'metal'},
 {text:'ik wil Nederlandse indie muziek, maar geen metal',language:'nl',country:'NL',genre:'indie',avoidGenre:'metal'},
 {text:'quiero música brasileña sin metal',language:'es',country:'BR',avoidGenre:'metal'},
 {text:'ich will ruhige deutsche Musik ohne Metal',language:'de',country:'DE',mood:'calm',avoidGenre:'metal'},
 {text:'je veux de la musique française calme',language:'fr',country:'FR',mood:'calm'},
 {text:'I want Dutch artists, singing in English',language:'en',country:'NL',vocal:'en'},
 {text:'ik wil muziek in het Nederlands',language:'nl',vocal:'nl',noCountry:'NL'},
 {text:'Nederlandstalige muziek, geen metal',language:'nl',vocal:'nl',noCountry:'NL',avoidGenre:'metal'},
 {text:'música em holandês',language:'pt',vocal:'nl',noCountry:'NL'},
 {text:'quero música de Portugal, cantada em português',language:'pt',country:'PT',vocal:'pt'},
 {text:'i want portuguese vocals from brazil',language:'en',country:'BR',vocal:'pt',noCountry:'PT'},
 {text:'Give me Brazilian music, not Dutch',country:'BR',avoidCountry:'NL'},
 {text:'não quero música brasileira',language:'pt',avoidCountry:'BR',noCountry:'BR'},
 {text:'niet nederlands maar braziliaans',language:'nl',country:'BR',avoidCountry:'NL'},
 {text:'quero bossa nova brasileira, sem samba',language:'pt',country:'BR',genre:'bossa nova',avoidGenre:'samba'},
 {text:'I want funk carioca from Brazil',country:'BR',genre:'funk carioca'},
 {text:'ik wil rocksteady, geen rock',language:'nl',genre:'rocksteady',avoidGenre:'rock'},
 {text:'quero forró brasileiro',language:'pt',country:'BR',genre:'forro'},
 {text:'Ik voel me verdrietig maar ik wil vrolijke muziek',language:'nl',mood:'hopeful',notMood:'melancholic',goalShift:true},
 {text:'ich brauche ruhige deutsche musik',language:'de',country:'DE',mood:'calm'},
 {text:'I want Japanese ambient',language:'en',country:'JP',genre:'ambient'},
 {text:'some Belgian electronic music',country:'BE',genre:'electronic'},
 {text:'Spanish-language records from Belgium',country:'BE',vocal:'es',noCountry:'ES'},
 {text:'I want Brazilian jazz, no Dutch artists',country:'BR',avoidCountry:'NL',genre:'jazz'}
];
for(const c of cases){
 const a=interpretFeeling(c.text);
 const eq=(condition,message)=>assert.ok(condition,c.text+' :: '+message+' :: '+JSON.stringify(a));
 if(c.language)eq(a.queryLanguage===c.language,'query language');
 if(c.country)eq(a.originCountries.includes(c.country),'country');
 if(c.avoidCountry)eq(a.avoidOriginCountries.includes(c.avoidCountry),'avoid country');
 if(c.noCountry)eq(!a.originCountries.includes(c.noCountry),'not artist country');
 if(c.vocal)eq(a.vocalLanguages.includes(c.vocal),'vocal language');
 if(c.genre)eq(a.genres.includes(c.genre),'genre');
 if(c.avoidGenre)eq(a.avoidGenres.includes(c.avoidGenre),'avoid genre');
 if(c.mood)eq(Object.hasOwn(a.moods,c.mood),'mood');
 if(c.notMood)eq(!Object.hasOwn(a.moods,c.notMood),'not mood');
 if(c.goalShift!==undefined)eq(a.goalShift===c.goalShift,'goal shift');
 const query=retrievalText(c.text);
 if(c.avoidGenre)eq(!query.includes(c.avoidGenre),'no excluded genre in query');
}
assert.equal(globalThis.AlbumIntent.styleMatches('rocksteady','rock'),false);
assert.equal(globalThis.AlbumIntent.styleMatches('indie pop','pop punk'),false);
assert.equal(globalThis.AlbumIntent.styleMatches('jazz fusion','jazz'),true);
console.log('24 multi-language origin, lyrics, compound-style and negation tests passed.');
