/* Multilingual listening intent, deliberately separate from album provenance.
   A listener's language, an artist's area, and lyric language are distinct.
   Lexical normalization is a safe fallback, not a claim of full translation. */
(function(root){
'use strict';
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘]/g,"'");
const unique=items=>[...new Set(items)];
const NEGATION=/(?:\b(?:not|no|without|avoid|avoiding|dont|don't|do not|nao|sem|geen|niet|zonder|kein|keine|nicht|ohne|sin|sans|pas|non)\b|(?:^|\s)(?:не|без|нет|ні)(?:\s|$))/u;
const BOUNDARY=/[,;.!?]|\b(?:but|however|mas|pero|maar|aber|mais|porem)\b/g;
function negated(text,start){
 const context=text.slice(Math.max(0,start-90),start);
 let from=0;for(const m of context.matchAll(BOUNDARY))from=m.index+m[0].length;
 const phrase=context.slice(from);
 return NEGATION.test(phrase);
}
const COUNTRIES={
 BR:['brazilian','brazil','brasil','brasileiro','brasileira','brasileiros','brasileiras','brasilian','braziliaans','braziliaanse','brasileno','brasilena','bresilien','bresilienne'],
 NL:['dutch','netherlands','nederland','nederlandse','nederlands','holland','hollands','hollandse','holandes','holandesa','neerlandes','neerlandaise'],
 PT:['portugal','portuguese','portugues','portuguesa','portugies','portugiese'],
 BE:['belgium','belgian','belgie','belgisch','belgische','belgique','belga','belgica','belge'],
 FR:['france','french','francais','francaise','frances','francesa','franzosisch'],
 DE:['germany','german','deutsch','deutsche','deutscher','deutschen','alemao','alema','aleman','alemana','deutschland'],
 ES:['spain','spanish','espanha','espanol','espanola','espanha','espana'],
 JP:['japan','japanese','japao','japones','japonesa','japanisch'],
 AR:['argentina','argentine','argentino','argentina'],
 NG:['nigeria','nigerian','nigeriana','nigeriano'],
 UA:['ukraine','ukrainian','ucrania','ucraniano','ucraniana','ukrainisch','україна','український','українська','українські','украинский','украина']
};
const VOCALS={
 nl:['dutch','nederlands','nederlandstalig','nederlandstalige','holandes','holandesa','neerlandes'],
 pt:['portuguese','portugues','portuguesa','portugies','portugiese','lusofono','lusofona'],
 en:['english','ingles','inglesa','engels','englisch','anglais'],
 es:['spanish','espanol','espanola','castellano','castellana'],
 fr:['french','francais','francaise','frances','francesa','franzosisch'],
 de:['german','deutsch','deutsche','alemao','alema','aleman','alemana'],
 ja:['japanese','japones','japonesa','japanisch'],
 uk:['ukrainian','ucraniano','ucraniana','ukrainisch','українською','українська','украинском','українською мовою'],
 ru:['russian','russo','russa','russisch','русском','русски','русский','по-русски'],
 ar:['arabic','árabe','arabe','عربي','العربية'],
 zh:['mandarin','chinese','chinois','chinês','中文','普通话','國語','国语']
};
const VOCAL_CONTEXT=/(?:\b(?:in|em|en|auf|sung|singing|sing|lyrics|vocals|vocais|cantad[oa]s?|cantand[oa]|gezongen|gesungen|chante|chant[eé]e?s?|gesungen|spracha|sprache)\s+(?:(?:the|het|la|o|in|em)\s+)?|(?:^|[^a-z])(?:nederlandstalig|deutschsprachig|francophone|lusofono|lusofona)\b)/;
const TRANSLATE=[
 ['ik voel me','i feel'],['ik ben','i am'],['ik wil','i want'],['ik zoek','looking for'],['geef me','give me'],
 ['een album','an album'],['een plaat','an album'],['muziek','music'],['zonder','without'],['geen','no'],
 ['niet','not'],['maar','but'],['dromerige','dreamy'],['dromerig','dreamy'],['verdrietig','sad'],
 ['rustige','calm'],['rustig','calm'],['kalme','calm'],['gezellig','warm cozy'],['vrolijke','hopeful'],
 ['vrolijk','hopeful'],['energiek','energetic'],['energieke','energetic'],['donkere','dark'],['donker','dark'],
 ['nostalgisch','nostalgic'],['nederpop','dutch pop'],['nederlandstalige','dutch language'],
 ['ich suche','looking for'],['ich mochte','i want'],['ich will','i want'],['ohne','without'],
 ['keine','no'],['kein','no'],['nicht','not'],['aber','but'],['musik','music'],
 ['ruhige','calm'],['ruhig','calm'],['traurig','sad'],['frohlich','hopeful'],['dunkel','dark'],
 ['je voudrais','i want'],['je cherche','looking for'],['je veux','i want'],['sans','without'],
 ['mais','but'],['musique','music'],['calme','calm'],['triste','sad'],['joyeuse','hopeful'],
 ['quiero','i want'],['busco','looking for'],['sin','without'],['pero','but'],
 ['musica','music'],['tranquila','calm'],['tranquilo','calm'],['alegre','hopeful'],
 ['я хочу','i want'],['хочу','i want'],['шукаю','looking for'],['ищу','looking for'],
 ['не хочу','i do not want'],['без','without'],['спокійна','calm'],['спокійний','calm'],
 ['спокійно','calm'],['сумно','sad'],['сумна','sad'],['сумний','sad'],
 ['грустная','sad'],['грустный','sad'],['спокойная','calm'],['спокойный','calm'],
 ['енергійна','energetic'],['енергійний','energetic'],
 ['quero','i want'],['procuro','looking for'],['preciso','i need'],['sem','without'],
 ['nao','not'],['porem','but'],['sombria','dark'],['sombrio','dark'],
 ['triste','sad'],['tranquila','calm'],['tranquilo','calm'],['animada','energetic'],
 ['animado','energetic'],['alegre','hopeful'],['sossegada','calm'],['sossegado','calm']
];
const LANG_CUES={
 ar:/[\u0600-\u06ff]/u,
 zh:/[\u4e00-\u9fff]/u,
 ja:/[\u3040-\u30ff]/u,
 uk:/(?:хочу|шукаю|українською|сумно|спокійн|енергійн)/u,
 ru:/(?:ищу|грустн|спокойн|русском|по-русски)/u,
 nl:/\b(?:ik wil|ik zoek|ik voel me|geen|zonder|muziek|nederlandse|nederlands|dromerig|rustig|vrolijk)\b/,
 pt:/\b(?:quero|preciso|estou|brasileiro|brasileira|nao|sem|sossegad|alegre|triste|em\s+(?:holandes|portugues|ingles))\b/,
 es:/\b(?:quiero|busco|espanol|sin|pero|estoy|brasilena|brasileno)\b/,
 de:/\b(?:ich will|ich suche|ohne|keine|nicht|musik|ruhig|traurig)\b/,
 fr:/\b(?:je veux|je cherche|musique|sans|mais|francais)\b/,
 en:/\b(?:i want|i need|i feel|give me|sung in|without|something|i'm)\b/
};
function phraseMatches(text,alias){
 const name=fold(alias);
 if(!name)return [];
 const escaped=[...name].map(ch=>{
  if(ch===' ')return '\\s+';
  if(ch==='-')return '-';
  if(/[\p{L}\p{N}]/u.test(ch))return ch;
  return '\\'+ch;
 }).join('');
 const re=new RegExp('(^|[^\\p{L}\\p{N}])('+escaped+')(?=$|[^\\p{L}\\p{N}])','gu');
 return [...text.matchAll(re)].map(m=>({start:m.index+m[1].length,end:m.index+m[1].length+m[2].length}));
}
function blankSpans(text,spans){
 const copy=[...text];for(const span of spans)for(let i=span.start;i<span.end;i++)copy[i]=' ';
 return copy.join('');
}

/* Basic lexical bridge for scripts without Latin word boundaries.
   Phrase recognition, not machine translation; user text stays private. */
const ASIAN_PHRASES=[
 ['ロックはなしで',' without rock '],['ロックなし',' without rock '],
 ['不要摇滚',' without rock '],['不要重金属',' without metal '],
 ['בלי רוק',' without rock '],
 ['بدون روك',' without rock '],['من دون روك',' without rock '],
 ['ロックは嫌',' without rock '],['メタルはなし',' without metal '],
 ['摇滚',' rock '],['ロック',' rock '],['重金属',' metal '],['メタル',' metal '],
 ['爵士',' jazz '],['ジャズ',' jazz '],['جاز',' jazz '],
 ['电子音乐',' electronic music '],['電子音楽',' electronic music '],
 ['ポップ',' pop '],['流行音乐',' pop music '],['بوب',' pop '],
 ['موسيقى',' music '],['音乐',' music '],['音楽',' music '],
 ['هادئة',' calm '],['هادئ',' calm '],['هادئًا',' calm '],
 ['安静',' calm '],['平静',' calm '],['静かな',' calm '],['穏やかな',' calm '],
 ['حزينة',' sad '],['حزين',' sad '],['悲伤',' sad '],['切ない',' melancholic '],
 ['悲しい',' sad '],['怀旧',' nostalgic '],['懐かしい',' nostalgic '],
 ['حالم',' dreamy '],['梦幻',' dreamy '],['夢のような',' dreamy '],
 ['نشيطة',' energetic '],['充满活力',' energetic '],['元気な',' energetic '],
 ['أريد',' i want '],['اريد',' i want '],['أبحث عن',' looking for '],
 ['我想听',' i want '],['想听',' i want '],['我想要',' i want '],
 ['聴きたい',' i want '],['聞きたい',' i want '],['探している',' looking for '],
 ['من دون',' without '],['بدون',' without '],['不要',' without '],
 ['なしで',' without '],['なし',' without '],
 ['من فضلك',' please '],['请',' please ']
];
function lexicalBridge(input){
 let result=input;
 for(const [from,to] of ASIAN_PHRASES){
  result=result.split(from).join(to);
 }
 return result.replace(/\s+/g,' ').trim();
}

function parse(value){
 const raw=fold(value);
 const queryLanguage=Object.keys(LANG_CUES).find(code=>LANG_CUES[code].test(raw))||'und';
 const vocalLanguages=[],avoidVocalLanguages=[],used=[];
 for(const [code,names] of Object.entries(VOCALS)){
  for(const name of names){
   for(const span of phraseMatches(raw,name)){
    const context=raw.slice(Math.max(0,span.start-45),span.start);
    const suffix=raw.slice(span.end,span.end+35);
    const explicit=VOCAL_CONTEXT.test(context) || /^(?:[- ](?:language|lyrics|vocals|songs|language music)|stalige?\b)/.test(suffix) || /(?:stalig|sprachig|fono|fone)/.test(name) || /^(?:українською|українською мовою|украинском|русском|по-русски)$/.test(name);
    if(!explicit)continue;
    used.push(span);
    (negated(raw,span.start)?avoidVocalLanguages:vocalLanguages).push(code);
   }
  }
 }
 const originCountries=[],avoidOriginCountries=[];
 const noVocals=blankSpans(raw,used);
 for(const [code,names] of Object.entries(COUNTRIES)){
  for(const name of names){
   for(const span of phraseMatches(noVocals,name)){
    (negated(noVocals,span.start)?avoidOriginCountries:originCountries).push(code);
   }
  }
 }
 let canonicalText=lexicalBridge(raw);
 const phrases=[...TRANSLATE].sort((a,b)=>b[0].length-a[0].length);
 for(const [from,to] of phrases){
  const matches=phraseMatches(canonicalText,from);
  for(let i=matches.length-1;i>=0;i--){
   const {start,end}=matches[i];
   canonicalText=canonicalText.slice(0,start)+to+canonicalText.slice(end);
  }
 }
 // Distinguish scripts for Japanese / Chinese / Arabic origin phrases.
 // These are explicit geography cues, never inferred from interface language.
 const geographicText=raw;
 if(/(?:日本の音楽|日本のアーティスト|日本音乐|日本歌手|日本艺术家)/u.test(geographicText))originCountries.push('JP');
 if(/(?:巴西音乐|巴西歌手|موسيقى برازيلية|موسيقى برازيلية)/u.test(geographicText))originCountries.push('BR');
 if(/(?:荷兰音乐|هولندية|هولندي)/u.test(geographicText))originCountries.push('NL');
 const countries=unique(originCountries).filter(c=>!avoidOriginCountries.includes(c));
 const vocal=unique(vocalLanguages).filter(c=>!avoidVocalLanguages.includes(c));
 // Positive location is an explicit retrieval hint; exclusions are constraints.
 const countryHints={BR:'brazilian music',NL:'dutch music',PT:'portuguese music',BE:'belgian music',FR:'french music',DE:'german music',ES:'spanish music',JP:'japanese music',AR:'argentinian music',NG:'nigerian music',UA:'ukrainian music'};
 const semanticText=[canonicalText,...countries.map(c=>countryHints[c]).filter(Boolean)].join(' ').trim();
 return {
  queryLanguage,canonicalText,semanticText,
  originCountries:countries,avoidOriginCountries:unique(avoidOriginCountries),
  vocalLanguages:vocal,avoidVocalLanguages:unique(avoidVocalLanguages)
 };
}
root.AlbumLocale={parse,fold,version:'multilingual-intent-v3'};
})(globalThis);
