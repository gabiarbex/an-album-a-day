(function(root){
'use strict';

const feelingLexicon={
 nostalgic:['nostalg','saudade','miss ','remember','memories','memory','childhood','past','used to','back then','homesick','lembranca','lembrar'],
 melancholic:['sad','cry','heartbreak','lonely','alone','grief','empty','devastat','blue','depress','miserable','sorrow','downbeat','somber','triste','chorar','solidao','luto','broken'],
 reflective:['think','thought','quiet','introspect','introspective','contemplat','confus','uncertain','meaning','question','ponder','overthink','thinking','pensando','pensar'],
 dreamy:['dream','float','floating','ethereal','hazy','airy','cloud','surreal','distant','escape','space','sonho','sonhar','dreaming'],
 warm:['warm','safe','hug','home','soft','gentle','cozy','love','tender','intimate','comforting','comfort','affection','close','carinho','abraco','amor','aconchego','quente','acolhedor','acolhedora','suave'],
 intense:['angry','rage','scream','furious','chaos','loud','explode','explosive','aggressive','hard-hitting','heavy','restless','raiva','gritar','intense'],
 energetic:['dance','party','run','drive fast','excited','alive','movement','move','upbeat','lively','high energy','fast-paced','fast paced','driving','pumping','bouncy','euphoric','dancar','festa','energia','animad'],
 dark:['dark','night','midnight','shadow','goth','haunt','ominous','eerie','bleak','noite','escuro','sombrio'],
 hopeful:['hope','better','healing','beginning','tomorrow','future','optimis','uplifting','positive','bright','esperanca','recomecar'],
 alienated:['stranger','disconnected','out of place','belong','unreal','isolated','dissociat','estranha','deslocad'],
 cold:['winter','cold','rain','fog','frost','icy','inverno','frio','chuva'],
 gritty:['raw','dirty','grunge','rough','punk','noise','abrasive','distort','sujo','bruto']
};

const genreLexicon=[
 'alternative','indie','rock','pop','electronic','house','techno','ambient','jazz','classical','metal','punk',
 'hip hop','rap','r&b','soul','folk','country','reggae','ska','latin','bossa nova','samba','mpb','shoegaze',
 'dream pop','post-punk','post punk','goth','darkwave','experimental','psychedelic','soundtrack','afrobeat'
];

function normalizeText(value){
 return String(value||'').toLocaleLowerCase().replace(/[’‘]/g,"'").normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function termIsNegated(text,index){
 const raw=text.slice(Math.max(0,index-64),index);
 // Negation should not leak through sentence/clause boundaries.
 const boundaries=[
  raw.lastIndexOf('.'),raw.lastIndexOf('!'),raw.lastIndexOf('?'),
  raw.lastIndexOf(';'),raw.lastIndexOf(','),
  raw.lastIndexOf(' but '),raw.lastIndexOf(' however '),
  raw.lastIndexOf(' mas '),raw.lastIndexOf(' porem ')
 ];
 const boundary=Math.max(...boundaries);
 const clause=raw.slice(boundary+1).replace(/[^a-z0-9' ]+/g,' ');
 return /\b(?:don't|dont|do not|not|without|avoid|avoiding|anything but|no|nao|sem|evita|evitar)\b(?:\s+\w+){0,4}\s*$/.test(clause);
}

function scanTerms(text,terms){
 let positive=0,negative=0;
 for(const raw of terms){
  const term=normalizeText(raw);
  let from=0;
  while(true){
   const i=text.indexOf(term,from);
   if(i<0)break;
   if(termIsNegated(text,i))negative++;else positive++;
   from=i+Math.max(1,term.length);
  }
 }
 return {positive,negative};
}

function interpretFeeling(text){
 const t=normalizeText(text);
 const moods={},avoidMoods={};

 for(const [m,terms] of Object.entries(feelingLexicon)){
  const hits=scanTerms(t,terms);
  if(hits.positive)moods[m]=Math.min(hits.positive,3);
  if(hits.negative)avoidMoods[m]=Math.min(hits.negative,3);
 }

 // Relationship longing is usually warmer/more intimate than generic "sad".
 if(/\bmiss(?:ing)?\b|\bsaudade\b/.test(t)&&/\b(girlfriend|boyfriend|partner|wife|husband|her|him|them|someone|amor|namorada|namorado|ela|ele|dela|dele)\b/.test(t)){
  moods.nostalgic=Math.max(moods.nostalgic||0,1);
  moods.warm=Math.max(moods.warm||0,1);
  if(!avoidMoods.melancholic)moods.melancholic=Math.max(moods.melancholic||0,1);
 }

 const genres=[],avoidGenres=[];
 // Longest first prevents "rock" in "post-punk" style phrases from dominating.
 for(const g of [...genreLexicon].sort((a,b)=>b.length-a.length)){
  let from=0,positive=false,negative=false;
  while(true){
   const i=t.indexOf(g,from);
   if(i<0)break;
   if(termIsNegated(t,i))negative=true;else positive=true;
   from=i+g.length;
  }
  if(positive)genres.push(g);
  if(negative)avoidGenres.push(g);
 }

 const ranked=Object.entries(moods).sort((a,b)=>b[1]-a[1]);
 const avoided=Object.entries(avoidMoods).sort((a,b)=>b[1]-a[1]);
 const highEnergy=scanTerms(t,[
  'dance','party','run','scream','rage','festa','dancar','gritar','alive','full blast',
  'upbeat','lively','high energy','fast-paced','fast paced','driving','pumping','bouncy','euphoric','animad'
 ]);
 const lowEnergy=scanTerms(t,[
  'quiet','slow','soft','gentle','sleep','calm','silencio','devagar','hushed','restrained','intimate','low energy'
 ]);
 const energy=highEnergy.positive>lowEnergy.positive?8:
              lowEnergy.positive>highEnergy.positive?3:null;
 const exploration=/weird|strange|left turn|surprise|unexpected|obscure|unknown|new to me|experimental|esquisit|diferente|fora do obvio/.test(t)?1:0;
 const parts=[];
 if(ranked.length)parts.push(ranked.slice(0,2).map(([m])=>m).join(' + '));
 if(genres.length)parts.push(genres.slice(0,2).join(' / '));
 if(avoided.length)parts.push('not '+avoided.slice(0,2).map(([m])=>m).join(' / '));
 if(avoidGenres.length)parts.push('not '+avoidGenres.slice(0,2).join(' / '));

 return {moods,avoidMoods,genres,avoidGenres,energy,exploration,summary:parts.join(' · ')};
}

root.AlbumIntent={interpretFeeling,termIsNegated,normalizeText,genreLexicon,feelingLexicon};
})(globalThis);
