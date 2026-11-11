/* Verified constraints run after neural scoring, before choosing a record.
   Similarity and personal taste must never override an explicit "no". */
import {genreConflict, moodConflict} from './_ranking-core.js';

const codes=list=>Array.isArray(list)?list.map(x=>String(x||'').toUpperCase()).filter(Boolean):[];
const languages=list=>Array.isArray(list)?list.map(x=>String(x||'').toLowerCase()).filter(Boolean):[];
const labels=list=>Array.isArray(list)?list.map(x=>String(x||'').toLowerCase()).filter(Boolean):[];

export function candidateAllowed(candidate,intent={},body={}){
 const origin=String(candidate?.originCountry||'').toUpperCase();
 const voices=languages(candidate?.vocalLanguages);
 const genres=[...(candidate?.genres||[]),...(candidate?.tags||[])];
 const excludedOrigins=codes(intent.avoidOriginCountries);
 const excludedVoices=languages(intent.avoidVocalLanguages);
 if(origin&&excludedOrigins.includes(origin))return false;
 // Do not claim an unlabelled album is vocal-language-safe.
 if(excludedVoices.length&&(!voices.length||excludedVoices.some(x=>voices.includes(x))))return false;
 if((intent.avoidGenres||[]).length&&(!genres.length||genreConflict(candidate,intent.avoidGenres)))return false;
 if(Object.keys(intent.avoidMoods||{}).length&&moodConflict(candidate,Object.keys(intent.avoidMoods)))return false;
 // A verified duration is a hard limit (2 minute tolerance for rounding).
 const max=body.time==null?NaN:Number(body.time);
 const runtime=candidate?.duration==null?NaN:Number(candidate.duration);
 if(Number.isFinite(max)&&Number.isFinite(runtime)&&runtime>max+2)return false;
 return true;
}

export function eligibleRanked(ranked,body={}){
 const intent=body.intent||{};
 const safe=ranked.filter(row=>candidateAllowed(row.candidate,intent,body));
 if(!safe.length)return {eligible:[],error:'No albums meet all of your exclusions or time limit.',reason:'excluded'};

 const origins=codes(intent.originCountries);
 const byOrigin=origins.length
  ? safe.filter(row=>origins.includes(String(row.candidate.originCountry||'').toUpperCase()))
  : safe;
 if(!byOrigin.length)return {eligible:[],error:'No artist in this shortlist has a verified match for the requested country. Try a broader description.',reason:'country'};

 const voices=languages(intent.vocalLanguages);
 const byVoice=voices.length
  ? byOrigin.filter(row=>languages(row.candidate.vocalLanguages).some(code=>voices.includes(code)))
  : byOrigin;
 if(!byVoice.length)return {eligible:[],error:'The catalogue cannot verify vocals in that language for the current shortlist. Try an artist or genre instead.',reason:'vocal-language'};

 return {eligible:byVoice,error:null,reason:null,excluded:ranked.length-safe.length,
  verifiedOrigins:origins.length?byOrigin.length:0,
  verifiedVocals:voices.length?byVoice.length:0};
}
