// Small, deterministic candidate-feature student for *offline* distillation.
// No weights are shipped to users until a human-judged relevance gate passes.
import {
  requestedGenreFit, requestedMoodFit, moodStyleSignal,
  genreConflict, isCompilation,
} from './_ranking-core.js';

export const STUDENT_SCHEMA='albumaday-student-features-v1';
export const STUDENT_FEATURES=[
  'baseline_score',
  'neural_similarity',
  'requested_genre_match',
  'known_genre_mismatch',
  'excluded_genre_conflict',
  'verified_mood_match',
  'known_mood_mismatch',
  'supporting_style',
  'contradictory_style',
  'goal_shift_style_support',
  'goal_shift_style_conflict',
  'compilation',
  'genre_tag_coverage',
  'profile_quality',
];

const num=(value,fallback=0)=>{
 const n=Number(value);
 return value!==null&&value!==undefined&&Number.isFinite(n)?n:fallback;
};
const safe=(value)=>Array.isArray(value)?value:[];

export function featureVector(record){
 const row=record||{};
 const c=row.candidate||{
  artist:row.artist,title:row.album||row.title,genres:row.genres,
  tags:row.tags,moods:row.moods,profileQuality:row.profile_quality,
  moodSource:row.mood_source,
 };
 const intent=row.query_intent||row.intent||{};
 const body={intent,moods:safe(row.requested_moods),note:row.prompt||''};
 const genre=requestedGenreFit(c,body);
 const mood=requestedMoodFit(c,body);
 const cues=moodStyleSignal(c,body);
 const isShift=Boolean(intent.goalShift);
 const listed=new Set([...safe(c.genres),...safe(c.tags)].map(v=>String(v).toLowerCase()));
 const avoided=safe(intent.avoidGenres);
 return [
  num(row.original_score??row.baselineScore,0.5),
  num(row.neural_score??row.neuralScore,0),
  genre.match?1:0,
  genre.requested&&genre.known&&!genre.match?1:0,
  genreConflict(c,avoided)?1:0,
  mood.match?1:0,
  mood.requested&&mood.known&&!mood.match?1:0,
  cues.bonus,
  cues.penalty,
  isShift?cues.bonus:0,
  isShift?cues.penalty:0,
  isCompilation(c)?1:0,
  Math.min(1,listed.size/12),
  num(c.profileQuality??row.profile_quality,0.5),
 ];
}

export function studentScore(record,artifact){
 if(!artifact||artifact.schema!==STUDENT_SCHEMA||
    JSON.stringify(artifact.features)!==JSON.stringify(STUDENT_FEATURES))return null;
 const {means,scales,weights}=artifact;
 if(![means,scales,weights].every(a=>Array.isArray(a)&&a.length===STUDENT_FEATURES.length))return null;
 const features=featureVector(record);
 let total=0;
 for(let i=0;i<features.length;i++){
  const weight=Number(weights[i]),mean=Number(means[i]),scale=Number(scales[i]);
  if(!Number.isFinite(weight)||!Number.isFinite(mean)||!Number.isFinite(scale)||scale<=0)return null;
  total+=weight*(features[i]-mean)/scale;
 }
 return Number.isFinite(total)?total:null;
}

export function rankStudent(rows,artifact){
 if(!Array.isArray(rows))return [];
 const eligible=rows.filter(row=>{
  const c=row.candidate||row;
  const intent=row.query_intent||row.intent||{};
  return !genreConflict(c,safe(intent.avoidGenres));
 });
 // No implicit fallback to a forbidden genre when the safe pool is empty.
 return eligible.map((row,index)=>({row,index,score:studentScore(row,artifact)}))
  .filter(item=>item.score!==null)
  .sort((a,b)=>b.score-a.score||a.index-b.index)
  .map(item=>({...item.row,student_score:item.score}));
}
