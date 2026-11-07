const assert=require('node:assert/strict');
require('../intent-core.js');
const {interpretFeeling,retrievalText}=globalThis.AlbumIntent;
const cases=[
 {text:"I'm sad but want uplifting music",yesM:['hopeful'],noM:['melancholic'],retrieveNot:['sad']},
 {text:"I'm anxious and need something calm",yesM:['calm'],retrieveNot:['anxious'],energy:3},
 {text:"me sinto triste mas quero algo tranquilo",yesM:['calm'],noM:['melancholic'],retrieveNot:['triste']},
 {text:"estou triste e quero bossa nova alegre",yesM:['hopeful'],noM:['melancholic'],yesG:['bossa nova']},
 {text:"I'm feeling nostalgic but need upbeat dance music",yesM:['energetic'],noM:['nostalgic'],energy:8},
 {text:"I feel lonely but want dark techno",yesM:['dark'],noM:['melancholic'],yesG:['techno']},
 {text:"I feel sad and want jazz",yesM:['melancholic'],yesG:['jazz'],shift:false},
 {text:"I'm feeling cold and I want punk, but no dream pop",yesM:['cold'],yesG:['punk'],avoidG:['dream pop'],noAvoidG:['pop'],noAvoidM:['dreamy'],shift:false},
 {text:"not dream pop, give me synth-pop",yesG:['synth-pop'],avoidG:['dream pop'],noAvoidG:['pop']},
 {text:"I want rocksteady, not rock",yesG:['rocksteady'],avoidG:['rock'],noG:['rock']},
 {text:"give me indie pop, not pop punk",yesG:['indie pop'],avoidG:['pop punk'],noAvoidG:['pop']},
 {text:"I feel dreamy and I want jazz, but no soul",yesM:['dreamy'],yesG:['jazz'],avoidG:['soul'],shift:false},
 {text:"I want sad music, not happy songs",yesM:['melancholic'],avoidM:['hopeful']},
 {text:"I feel hopeful but want melancholic music",yesM:['melancholic'],noM:['hopeful'],shift:true},
 {text:"I feel sad and want sad music",yesM:['melancholic'],shift:false},
 {text:"I want jazz, not metal",yesG:['jazz'],avoidG:['metal']},
 {text:"I feel gloomy but want soothing ambient pop",yesM:['calm'],yesG:['ambient pop']},
 {text:"I feel a bit low, play something energetic",yesM:['energetic'],energy:8,shift:true},
 {text:"estou triste mas quero algo alegre",yesM:['hopeful'],noM:['melancholic'],shift:true},
 {text:"I want darkwave, not goth",yesG:['darkwave'],avoidG:['goth']}
];
const fields=[
 ['yesM',row=>Object.keys(row.moods),true],['noM',row=>Object.keys(row.moods),false],
 ['avoidM',row=>Object.keys(row.avoidMoods),true],['noAvoidM',row=>Object.keys(row.avoidMoods),false],
 ['yesG',row=>row.genres,true],['noG',row=>row.genres,false],
 ['avoidG',row=>row.avoidGenres,true],['noAvoidG',row=>row.avoidGenres,false]
];
for(const c of cases){
 const actual=interpretFeeling(c.text);
 for(const [field,get,present] of fields){
  for(const term of c[field]||[])assert.equal(get(actual).includes(term),present,
   JSON.stringify({text:c.text,field,term,actual}));
 }
 if(c.energy!==undefined)assert.equal(actual.energy,c.energy,c.text);
 if(c.shift!==undefined)assert.equal(actual.goalShift,c.shift,c.text);
 const retrieval=retrievalText(c.text);
 for(const word of c.retrieveNot||[])assert.ok(!retrieval.includes(word),c.text+': retrieval leaked '+word);
}
console.log('20 contextual emotional-goal and compound-style regressions passed');
