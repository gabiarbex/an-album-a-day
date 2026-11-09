const assert=require('node:assert/strict');
require('../album-locale.js');
require('../intent-core.js');
const {interpretFeeling,retrievalText}=globalThis.AlbumIntent;
// Synthetic prompts: never commit a listener's private diary to the public repo.
const cases=[
 {id:'regret-uncertainty-en',note:"I had an awful argument with my partner, and I regret what I said. I don't know if our relationship can last; losing them would break my heart.",moods:['melancholic','reflective'],kind:'relationship-uncertainty',themes:['conflict','uncertainty','regret','fear of loss']},
 {id:'hard-relationship-en',note:"My girlfriend and I keep fighting. Things have been difficult and I feel guilty. I'm scared we might separate.",moods:['melancholic','reflective'],kind:'relationship-uncertainty'},
 {id:'romance-uncertain-en',note:"My relationship feels fragile, and I don't know whether we have a future.",moods:[],kind:null},
 {id:'not-hope-future-en',note:"I'm not sure what the future holds, and I feel uncertain.",moods:[],kind:null},
 {id:'relationship-repair-pt',note:"briguei com minha namorada e estou arrependida; nosso relacionamento está difícil e não sei se temos futuro.",moods:['melancholic','reflective'],kind:'relationship-uncertainty'},
 {id:'relationship-repair-nl',note:"Ik heb ruzie met mijn vriendin en ik twijfel of onze relatie toekomst heeft.",moods:['melancholic','reflective'],kind:'relationship-uncertainty'},
 {id:'normal-hope',note:"I want something hopeful for the future",moods:['hopeful'],kind:null},
 {id:'contrast-request',note:"I'm sad about my relationship but I want happy upbeat pop music",moods:['hopeful'],kind:null},
 {id:'nostalgia-other',note:"I feel homesick and miss someone",moods:['nostalgic'],kind:null},
 {id:'genre-exclusion',note:"I want indie folk but not metal",moods:[],kind:null,genre:'indie',avoid:'metal'},
 {id:'positive-goal',note:"I'm sad but want uplifting music",moods:['hopeful'],kind:null,shift:true}
];
for(const c of cases){
 const intent=interpretFeeling(c.note),retrieval=retrievalText(c.note);
 assert.equal(intent.narrativeKind,c.kind,c.id+': narrative classifier');
 for(const mood of c.moods)assert.ok(intent.moods[mood],c.id+': '+mood);
 if(c.kind){
  assert.ok(!intent.moods.hopeful,c.id+': future != optimism');
  assert.ok(retrieval.includes('intimate reflective melancholic'),c.id+': music direction retrieval');
  assert.ok(!retrieval.includes('awful argument'),c.id+': no private narrative in retrieval');
 }
 for(const theme of c.themes||[])assert.ok(intent.narrativeThemes.includes(theme),c.id+': '+theme);
 if(c.genre)assert.ok(intent.genres.includes(c.genre),c.id+': genre');
 if(c.avoid)assert.ok(intent.avoidGenres.includes(c.avoid),c.id+': excluded style');
 if(c.shift!==undefined)assert.equal(intent.goalShift,c.shift,c.id+': goal shift');
}
console.log(cases.length+' relationship and opposite-goal interpretation contracts passed.');
