(function(root){
'use strict';

const feelingLexicon={
 nostalgic:['nostalg','saudade','miss ','remember','memories','memory','childhood','past','used to','back then','homesick','lembranca','lembrar'],
 melancholic:['melanchol','sad','cry','heartbreak','lonely','alone','grief','empty','devastat','blue','depress','miserable','sorrow','downbeat','somber','triste','chorar','solidao','luto','broken'],
 reflective:['reflective','reflection','think','thought','quiet','introspect','introspective','contemplat','confus','uncertain','meaning','question','ponder','overthink','thinking','pensando','pensar'],
 dreamy:['dream','float','floating','ethereal','hazy','airy','cloud','surreal','distant','escape','space','sonho','sonhar','dreaming'],
 calm:['calm','peaceful','soothing','serene','tranquil','relax','hushed','sosseg','calmo','calma','tranquilo','tranquila','paz'],
 warm:['warm','safe','hug','home','soft','gentle','cozy','love','tender','intimate','comforting','comfort','affection','close','carinho','abraco','amor','aconchego','quente','acolhedor','acolhedora','suave'],
 intense:['angry','rage','scream','furious','chaos','loud','explode','explosive','aggressive','hard-hitting','heavy','restless','raiva','gritar','intense'],
 energetic:['energetic','dance','party','run','drive fast','excited','alive','movement','move','upbeat','lively','high energy','fast-paced','fast paced','driving','pumping','bouncy','euphoric','dancar','festa','energia','animad'],
 dark:['dark','night','midnight','shadow','goth','haunt','ominous','eerie','bleak','noite','escuro','sombrio'],
 hopeful:['hope','better','healing','beginning','tomorrow','optimis','uplifting','positive','bright','happy','cheerful','alegre','feliz','esperanca','recomecar'],
 alienated:['stranger','disconnected','out of place','belong','unreal','isolated','dissociat','estranha','deslocad'],
 cold:['winter','cold','rain','fog','frost','icy','inverno','frio','chuva'],
 gritty:['raw','dirty','grunge','rough','punk','noise','abrasive','distort','sujo','bruto']
};

const genreLexicon=[
 'alternative','indie','rock','pop','electronic','house','techno','ambient','jazz','classical','metal','punk',
 'hip hop','rap','r&b','soul','folk','country','reggae','ska','latin','bossa nova','samba','mpb','shoegaze',
 'dream pop','synth-pop','synth pop','indie pop','indie rock','art pop','pop punk',
 'punk rock','post-rock','post rock','garage rock','ambient techno','acid jazz',
 'nu jazz','soul jazz','jazz fusion','ambient pop','neo soul',
 'contemporary jazz','rocksteady','trip hop','downtempo','drum and bass','chillwave',
 'post-punk','post punk','goth','darkwave','experimental','psychedelic','soundtrack','afrobeat',
 'nederpop','nederhop','levenslied','smartlap','gabber','hardstyle','fado','forro','forró',
 'pagode','funk carioca','sertanejo','axe','axé','samba rock','brega','mangue beat','city pop','j-pop','afrobeats'
];

function styleMatches(label, requested){
 const norm=v=>normalizeText(v).replace(/[^a-z0-9]+/g,' ').trim();
 const full=norm(label),part=norm(requested);
 return Boolean(full&&part&&(' '+full+' ').includes(' '+part+' '));
}

function genreMentions(text){
 const genres=[],avoidGenres=[],spans=[];
 const escape=value=>value.replace(/[^a-z0-9 ]/g,ch=>'\\'+ch).replace(/ +/g,'\\s+');
 for(const genre of [...genreLexicon].sort((a,b)=>b.length-a.length)){
  const re=new RegExp('(^|[^a-z0-9])('+escape(genre)+')(?=$|[^a-z0-9])','g');
  for(const match of text.matchAll(re)){
   const start=match.index+match[1].length,end=start+match[2].length;
   if(spans.some(([a,b])=>start<b&&end>a))continue;
   spans.push([start,end]);
   const dest=termIsNegated(text,start)?avoidGenres:genres;
   if(!dest.includes(genre))dest.push(genre);
  }
 }
 const chars=[...text];
 for(const [start,end] of spans)for(let i=start;i<end;i++)chars[i]=' ';
 return {genres,avoidGenres,moodText:chars.join('')};
}

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

// Split a listener's present emotion from a *different* explicitly requested
// musical outcome. "I feel sad but want uplifting music" is not a request for
// a sad album. With no contrasting requested mood, preserve the older
// empathetic matching behavior ("I feel dreamy and want jazz").
function desiredListeningGoal(value){
 const t=normalizeText(value);
 const moodText=genreMentions(t).moodText;
 const state=/\b(?:i(?:'m| am)|i feel|feeling|me sinto|estou|to me sentindo)\b/.exec(t);
 if(!state)return null;
 const cues=[
  /\b(?:but|however|mas|porem)\s+(?:(?:i|eu)\s+)?(?:want|need|would like|prefer|quero|preciso|queria|prefiro)\b/g,
  /\b(?:and|e)\s+(?:(?:i|eu)\s+)?(?:want|need|would like|prefer|quero|preciso|queria|prefiro)\b/g,
  /(?:^|[,;.!?]\s*)(?:(?:i|eu)\s+)?(?:want|need|would like|prefer|quero|preciso|queria|prefiro)\b/g,
  /\b(?:give me|play me|play|find me|looking for|me de|coloca|bota|poe)\b/g
 ];
 const found=[];
 for(const re of cues){
  for(const match of t.matchAll(re)){
   if(match.index>state.index+state[0].length)found.push(match.index);
  }
 }
 if(!found.length)return null;
 const start=Math.min(...found);
 const target=moodText.slice(start);
 const earlier=moodText.slice(0,start);
 const stateMoods={},desiredMoods={};
 for(const [m,terms] of Object.entries(feelingLexicon)){
  if(scanTerms(earlier,terms).positive)stateMoods[m]=1;
  // A genre such as punk must not be mistaken for an explicitly desired
  // emotion and erase the user's current emotional context.
  const moodWords=terms.filter(term=>!['punk','noise','grunge','goth'].includes(term));
  if(scanTerms(target,moodWords).positive)desiredMoods[m]=1;
 }
 if(!Object.keys(desiredMoods).some(m=>!stateMoods[m]))return null;
 return {start,stateMoods,desiredMoods};
}

// Detect *emotional context*, not the musical style or a diagnosis.
// In particular "I don't know if we have a future" is uncertainty, not hope.
function relationshipNarrative(text){
 const t=normalizeText(text);
 const partner=/\b(?:girlfriend|boyfriend|partner|wife|husband|relationship|marriage|spouse|namorad[ao]|relacionamento|parceir[ao]|casamento|vriendin|vriendje|relatie|pareja|novi[ao])\b/.test(t);
 if(!partner)return null;
 const conflict=/\b(?:fight|fought|argument|argu(?:e|ed|ing)|disagreement|tension|hard lately|really hard|difficult|struggling|briga|briguei|brigamos|discussao|discuti|discutimos|moeilijk|ruzie|streit|pelea|discusion)\b/.test(t);
 const uncertain=/\b(?:idk|i don't know|i dont know|not sure|unsure|whether|if we|future|will (?:we|it)|could end|might end|breaking up|break up|separat|end of us|terminar|acabou|futuro|nao sei|incerto|incerta|twijfel|onzeker|duda|futuro)\b/.test(t);
 const loss=/\b(?:break my heart|breaks my heart|broken heart|heartbroken|heartbreak|lose (?:her|him|them|my)|losing (?:her|him|them|my)|can't lose|cant lose|saudade|coracao partido|coracao quebrado|meu coracao|perder (?:ela|ele|voce)|perd(?:er|endo)|verlieren|verlies)\b/.test(t);
 const regret=/\b(?:i'm sorry|im sorry|i am sorry|apolog|regret|my fault|guilty|culpa|desculp|arrepend|me arrependo|sinto muito|schuld|spijt|perdon|lo siento)\b/.test(t);
 if(!(loss||(conflict&&(uncertain||regret))||(uncertain&&regret)))return null;
 // Explicitly requested *musical outcome* overrides current distress.
 const desiredSound=/\b(?:i (?:want|need|would like|prefer)|give me|play me|quero|preciso|ik wil|ich will|quiero)\b[\s\S]{0,85}\b(?:uplifting|happy|cheerful|energetic|danceable|dance music|party|euphoric|upbeat|alegre|animad[ao]|dancar|fest[ae]|vrolijk|energiek|frohlich)\b/.test(t);
 const themes=[conflict?'conflict':null,uncertain?'uncertainty':null,regret?'regret':null,loss?'fear of loss':null].filter(Boolean);
 return {kind:'relationship-uncertainty',themes,goalOverride:desiredSound,
  // This phrase is a music-search hint, not a claim about the listener's mental health.
  retrievalHint:'intimate reflective melancholic bittersweet tender vulnerable quiet relationship heartbreak uncertainty regret singer-songwriter slowcore indie folk chamber pop acoustic'};
}

function interpretFeeling(text){
 const locale=root.AlbumLocale?.parse?.(text)||null;
 const t=normalizeText(locale?.canonicalText??text);
 const parsedGenres=genreMentions(t);
 const goal=desiredListeningGoal(t);
 const relationship=relationshipNarrative(t);
 const moods={},avoidMoods={};

 for(const [m,terms] of Object.entries(feelingLexicon)){
  const hits=scanTerms(parsedGenres.moodText,terms);
  if(hits.positive)moods[m]=Math.min(hits.positive,3);
  if(hits.negative)avoidMoods[m]=Math.min(hits.negative,3);
 }

 // Don't confuse the feeling someone is in with a different sound they
 // explicitly requested to help move through that feeling.
 if(goal){
  for(const mood of Object.keys(moods))if(!goal.desiredMoods[mood])delete moods[mood];
 }

 // A disagreement about a relationship's future is not "hopeful" just
 // because the word future appears. Match the conflicted, vulnerable tone
 // unless the listener explicitly asks the music to lift their mood.
 if(relationship&&!relationship.goalOverride&&!goal?.desiredMoods?.hopeful){
  moods.melancholic=Math.max(2,moods.melancholic||0);
  moods.reflective=Math.max(2,moods.reflective||0);
  if(relationship.themes.includes('fear of loss'))moods.nostalgic=Math.max(1,moods.nostalgic||0);
  delete moods.hopeful;
 }

 // Relationship longing is usually warmer/more intimate than generic "sad".
 if(/\bmiss(?:ing)?\b|\bsaudade\b/.test(t)&&/\b(girlfriend|boyfriend|partner|wife|husband|her|him|them|someone|amor|namorada|namorado|ela|ele|dela|dele)\b/.test(t)){
  moods.nostalgic=Math.max(moods.nostalgic||0,1);
  moods.warm=Math.max(moods.warm||0,1);
  if(!avoidMoods.melancholic)moods.melancholic=Math.max(moods.melancholic||0,1);
 }

 const {genres,avoidGenres}=parsedGenres;

 const ranked=Object.entries(moods).sort((a,b)=>b[1]-a[1]);
 const avoided=Object.entries(avoidMoods).sort((a,b)=>b[1]-a[1]);
 const goalText=goal?t.slice(goal.start):t;
 const highEnergy=scanTerms(goalText,[
  'dance','party','run','scream','rage','festa','dancar','gritar','alive','full blast',
  'upbeat','energetic','lively','high energy','fast-paced','fast paced','driving','pumping','bouncy','euphoric','animad'
 ]);
 const lowEnergy=scanTerms(goalText,[
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

 return {moods,avoidMoods,genres,avoidGenres,energy,exploration,
  originCountries:locale?.originCountries||[],avoidOriginCountries:locale?.avoidOriginCountries||[],
  vocalLanguages:locale?.vocalLanguages||[],avoidVocalLanguages:locale?.avoidVocalLanguages||[],
  queryLanguage:locale?.queryLanguage||'und',
  narrativeKind:relationship&&!relationship.goalOverride&&!goal?'relationship-uncertainty':null,
  narrativeThemes:relationship?.themes||[],
  listenerState:goal?.stateMoods||{},desiredMoods:goal?.desiredMoods||{},
  goalShift:Boolean(goal||relationship?.goalOverride),summary:parts.join(' · ')};
}

// Retrieval models match words rather than logic: "not metal" can otherwise
// retrieve metal more strongly. Keep the raw note for intent/reranking, but
// remove explicit exclusion spans before embedding or lexical retrieval.
function retrievalText(value){
 const locale=root.AlbumLocale?.parse?.(value)||null;
 const raw=normalizeText(locale?.canonicalText??value).replace(/\s+/g,' ').trim();
 const goal=desiredListeningGoal(raw);
 const relationship=relationshipNarrative(raw);
 // The full personal story can contain semantically misleading words like
 // "future", "fight", "sorry", or "never". Search the *musical direction*
 // rather than treating those words as album-title evidence.
 if(relationship&&!relationship.goalOverride&&!goal)return relationship.retrievalHint;
 const text=goal?raw.slice(goal.start):raw;
 if(!text)return '';
 const clauses=text.split(/([,;.!?]|\bbut\b|\bhowever\b|\bmas\b|\bporem\b)/i);
 const kept=[];
 for(let i=0;i<clauses.length;i+=2){
  const clause=(clauses[i]||'').trim();
  if(!clause)continue;
  // Remove the negative request from the first negation onwards, retaining
  // any earlier positive context in the same clause.
  const match=/\b(?:don't|dont|do not|not|without|avoid|avoiding|anything but|no|nao|sem|evita|evitar)\b/i.exec(clause);
  const positive=match?clause.slice(0,match.index).trim():clause;
  if(positive)kept.push(positive);
 }
 const positive=kept.join(' ').replace(/\s+/g,' ').trim();
 const countryHints={BR:'brazilian music',NL:'dutch music',PT:'portuguese music',BE:'belgian music',
  DE:'german music',FR:'french music',ES:'spanish music',JP:'japanese music',AR:'argentinian music',
  NG:'nigerian music',UA:'ukrainian music'};
 const extra=(locale?.originCountries||[]).map(c=>countryHints[c]).filter(Boolean);
 return [positive,...extra].filter(Boolean).join(' ').trim();
}

root.AlbumIntent={interpretFeeling,relationshipNarrative,desiredListeningGoal,retrievalText,termIsNegated,normalizeText,styleMatches,genreMentions,genreLexicon,feelingLexicon};
})(globalThis);
