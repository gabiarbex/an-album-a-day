#!/usr/bin/env node
// Query-grouped offline distillation. NEVER enables the student in production.
// Labels are cross-encoder *opinions*, not human ground truth.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {STUDENT_SCHEMA,STUDENT_FEATURES,featureVector,studentScore} from '../api/_student-ranker.js';
import {genreConflict} from '../api/_ranking-core.js';

const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const hash=value=>{
 let h=2166136261;
 for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,16777619)}
 return h>>>0;
};
const dot=(a,b)=>a.reduce((total,v,i)=>total+v*b[i],0);
const stable=(a,b)=>hash(a.id)-hash(b.id)||a.id.localeCompare(b.id);

export function prepareGroups(payload){
 const rows=Array.isArray(payload?.results)?payload.results:[];
 const groups=new Map();
 const seen=new Set();
 for(const row of rows){
  if(typeof row.query_id!=='string'||!row.query_id.trim())throw Error('Missing query ID');
  if(typeof row.prompt!=='string'||!row.prompt.trim())throw Error('Missing listening prompt');
  if(!row.album_id&&!row.album&&!row.title)throw Error('Missing album identity');
  if(typeof row.teacher_score!=='number'||!Number.isFinite(row.teacher_score))throw Error('Teacher score missing: run --score first');
  const id=row.query_id.trim();
  const candidateId=String(row.album_id||row.artist+'::'+row.album);
  const identity=id+'|'+candidateId;
  if(seen.has(identity))throw Error('Duplicate candidate within query: '+identity);
  seen.add(identity);
  const intent=row.query_intent||{};
  if(genreConflict(row,Array.isArray(intent.avoidGenres)?intent.avoidGenres:[]))continue;
  const group=groups.get(id)||{id,prompt:row.prompt,language:String(row.language||'unknown').toLowerCase(),category:row.category||'unknown',rows:[]};
  if(group.prompt!==row.prompt)throw Error('Different prompts share query ID '+id);
  group.rows.push({...row,feature:featureVector(row)});
  groups.set(id,group);
 }
 return [...groups.values()].filter(g=>g.rows.length>=2).sort((a,b)=>a.id.localeCompare(b.id));
}

export function splitByQuery(groups){
 const languages=new Map();
 for(const g of groups){
  const lang=g.language||'unknown';
  if(!languages.has(lang))languages.set(lang,[]);
  languages.get(lang).push(g);
 }
 const training=[],validation=[];
 for(const set of languages.values()){
  set.sort(stable);
  const held=set.length>=3?Math.max(1,Math.floor(set.length*.25)):0;
  validation.push(...set.slice(0,held));
  training.push(...set.slice(held));
 }
 if(!validation.length&&training.length>=3)validation.push(training.shift());
 return {training:training.sort((a,b)=>a.id.localeCompare(b.id)),
         validation:validation.sort((a,b)=>a.id.localeCompare(b.id))};
}

function normalizeFeatures(training){
 const d=STUDENT_FEATURES.length;
 const features=training.flatMap(group=>group.rows.map(row=>row.feature));
 const means=Array.from({length:d},(_,i)=>features.reduce((s,x)=>s+x[i],0)/features.length);
 const scales=Array.from({length:d},(_,i)=>{
  const variance=features.reduce((s,x)=>s+(x[i]-means[i])**2,0)/features.length;
  return Math.max(Math.sqrt(variance),0.05);
 });
 const normalized=vector=>vector.map((v,i)=>(v-means[i])/scales[i]);
 return {means,scales,normalized};
}

function buildPairs(groups,normalized){
 const sets=[];
 for(const group of groups){
  const ranked=[...group.rows].sort((a,b)=>b.teacher_score-a.teacher_score||a.rank-b.rank);
  const range=Math.max(1e-4,ranked[0].teacher_score-ranked.at(-1).teacher_score);
  const pairs=[];
  for(let i=0;i<group.rows.length;i++)for(let j=i+1;j<group.rows.length;j++){
   const left=group.rows[i],right=group.rows[j];
   const diff=normalized(left.feature).map((v,n)=>v-normalized(right.feature)[n]);
   const softTarget=sigmoid((left.teacher_score-right.teacher_score)/range*4);
   pairs.push({diff,softTarget,left,right});
  }
  if(pairs.length)sets.push({group,pairs});
 }
 return sets;
}

function loss(sets,weights,lambda){
 if(!sets.length)return null;
 let total=0;
 for(const set of sets){
  let groupLoss=0;
  for(const pair of set.pairs){
   const p=Math.min(1-1e-8,Math.max(1e-8,sigmoid(dot(weights,pair.diff))));
   const y=pair.softTarget;
   groupLoss+=-(y*Math.log(p)+(1-y)*Math.log(1-p));
  }
  total+=groupLoss/set.pairs.length;
 }
 return total/sets.length+lambda/2*dot(weights,weights);
}

export function teacherMetrics(groups,model){
 let pairs=0,correct=0,queryCount=0,top1=0,oldTop1=0;
 const byLanguage={};
 for(const group of groups){
  const scored=group.rows.map(row=>({...row,student:studentScore(row,model)}));
  if(scored.some(row=>row.student===null))throw Error('Invalid student model output');
  const teacher=[...scored].sort((a,b)=>b.teacher_score-a.teacher_score||a.rank-b.rank);
  const student=[...scored].sort((a,b)=>b.student-a.student||a.rank-b.rank);
  const old=[...scored].sort((a,b)=>a.rank-b.rank);
  const equalTop=student[0].album_id===teacher[0].album_id;
  if(equalTop)top1++;
  if(old[0].album_id===teacher[0].album_id)oldTop1++;
  queryCount++;
  const language=group.language;
  const sub=byLanguage[language]||(byLanguage[language]={queries:0,top1:0});
  sub.queries++;if(equalTop)sub.top1++;
  for(let i=0;i<scored.length;i++)for(let j=i+1;j<scored.length;j++){
   const truth=Math.sign(scored[i].teacher_score-scored[j].teacher_score);
   if(!truth)continue;
   const pred=Math.sign(scored[i].student-scored[j].student);
   pairs++;if(pred===truth)correct++;
  }
 }
 return {
  queries:queryCount,
  pairs,
  pairwise_teacher_agreement:pairs?Number((correct/pairs).toFixed(4)):null,
  student_teacher_top1_agreement:queryCount?Number((top1/queryCount).toFixed(4)):null,
  original_teacher_top1_agreement:queryCount?Number((oldTop1/queryCount).toFixed(4)):null,
  by_language:byLanguage,
 };
}

export function trainStudent(payload,options={}){
 const groups=prepareGroups(payload);
 const minQueries=options.allowSmall?4:Math.max(40,Number(options.minQueries)||40);
 if(groups.length<minQueries)throw Error('Insufficient distinct scored queries: '+groups.length+'; require '+minQueries+
  '. This is not a trainable relevance benchmark yet.');
 const {training,validation}=splitByQuery(groups);
 if(training.length<3||!validation.length)throw Error('Need multiple unseen query groups');
 const {means,scales,normalized}=normalizeFeatures(training);
 const trainSets=buildPairs(training,normalized),valSets=buildPairs(validation,normalized);
 const d=STUDENT_FEATURES.length;
 let weights=new Array(d).fill(0),bestWeights=weights.slice();
 let best=Infinity,patience=0,bestEpoch=0;
 const m=new Array(d).fill(0),v=new Array(d).fill(0);
 const lambda=0.035,lr=0.04,epochs=Math.min(500,Math.max(40,Number(options.epochs)||240));
 for(let epoch=1;epoch<=epochs;epoch++){
  const grad=weights.map(weight=>lambda*weight);
  for(const set of trainSets)for(const pair of set.pairs){
   const diff=sigmoid(dot(weights,pair.diff))-pair.softTarget;
   for(let i=0;i<d;i++)grad[i]+=diff*pair.diff[i]/trainSets.length/set.pairs.length;
  }
  for(let i=0;i<d;i++){
   m[i]=.9*m[i]+.1*grad[i];v[i]=.999*v[i]+.001*grad[i]*grad[i];
   weights[i]-=lr*(m[i]/(1-.9**epoch))/(Math.sqrt(v[i]/(1-.999**epoch))+1e-8);
  }
  const validationLoss=loss(valSets,weights,lambda);
  if(validationLoss+1e-6<best){best=validationLoss;bestWeights=weights.slice();bestEpoch=epoch;patience=0}
  else if(++patience>=45)break;
 }
 const model={
  schema:STUDENT_SCHEMA,features:[...STUDENT_FEATURES],
  means:means.map(x=>Number(x.toFixed(8))),scales:scales.map(x=>Number(x.toFixed(8))),
  weights:bestWeights.map(x=>Number(x.toFixed(8))),
  provenance:{
   type:'cross-encoder-teacher-distillation',
   teacher_model:payload.model||'unknown',
   training_query_count:training.length,
   validation_query_count:validation.length,
   train_query_ids:training.map(x=>x.id),
   validation_query_ids:validation.map(x=>x.id),
   best_epoch:bestEpoch,
   teacher_labels_are_human_ratings:false,
   human_relevance_evaluated:false,
  },
  eligible_for_production:false,
 };
 return {model,metrics:{
   validation:teacherMetrics(validation,model),
   training:teacherMetrics(training,model),
   validation_pairwise_loss:Number(best.toFixed(5)),
   note:'Agreement is only against the cross-encoder teacher. It does not demonstrate human music relevance.'
 }};
}

async function main(){
 const args=process.argv.slice(2);
 const opt=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const teacher=opt('--teacher');
 const output=opt('--output');
 if(!teacher||!output){
  console.error('Usage: node scripts/train-student.mjs --teacher teacher-scores.json --output /tmp/student.json [--allow-small-experiment]');
  process.exitCode=2;return;
 }
 const payload=JSON.parse(await fs.readFile(teacher,'utf8'));
 const result=trainStudent(payload,{allowSmall:args.includes('--allow-small-experiment')});
 await fs.writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
 console.log(JSON.stringify({saved:output,metrics:result.metrics,eligible_for_production:false},null,2));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(error=>{console.error(String(error?.message||error));process.exitCode=1});
}
