#!/usr/bin/env node
// Human-judged challenger comparison. Never uses teacher scores as truth.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {rankStudent} from '../api/_student-ranker.js';

const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const identity=(q,a,t)=>JSON.stringify([q,norm(a),norm(t)]);
function csvRows(csv){
 const records=[],row=[];let field='',quoted=false;
 for(let i=0;i<csv.length;i++){
  const ch=csv[i];
  if(quoted){
   if(ch==='"'&&csv[i+1]==='"'){field+='"';i++}
   else if(ch==='"')quoted=false;
   else field+=ch;
  }else if(ch==='"')quoted=true;
  else if(ch===','){row.push(field);field=''}
  else if(ch==='\n'){row.push(field);if(row.some(v=>v.trim()))records.push([...row]);row.length=0;field=''}
  else if(ch!=='\r')field+=ch;
 }
 if(quoted)throw Error('Unclosed CSV quote');
 if(row.length||field){row.push(field);if(row.some(v=>v.trim()))records.push(row)}
 const header=records.shift()||[];
 for(const required of ['query_id','artist','album','relevance'])if(!header.includes(required))throw Error('Judgment CSV lacks '+required);
 return records.map(values=>Object.fromEntries(header.map((name,i)=>[name,values[i]??''])));
}
const ndcg=(rows)=>{
 const gains=rows.map(r=>2**r.grade-1);
 const dcg=values=>values.reduce((total,g,i)=>total+g/Math.log2(i+2),0);
 const ideal=[...gains].sort((a,b)=>b-a);
 return ideal.every(x=>x===0)?0:dcg(gains)/dcg(ideal);
};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const intervals=(diffs,reps=1500)=>{
 if(diffs.length<2)return null;
 let state=0x7610f1ab;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296};
 const trials=[];
 for(let i=0;i<reps;i++){
  let sum=0;for(let j=0;j<diffs.length;j++)sum+=diffs[Math.floor(random()*diffs.length)];
  trials.push(sum/diffs.length);
 }
 trials.sort((a,b)=>a-b);
 return [trials[Math.floor(reps*.025)],trials[Math.floor(reps*.975)]].map(n=>Number(n.toFixed(5)));
};

export function evaluateHuman(teacher,artifact,judgmentCsv,{k=5,minQueries=40}={}){
 const judgments=csvRows(judgmentCsv),lookup=new Map();
 for(const row of judgments){
  if(row.relevance==='')continue;
  const grade=Number(row.relevance);
  if(!Number.isInteger(grade)||grade<0||grade>3)throw Error('Invalid human grade');
  const key=identity(row.query_id,row.artist,row.album);
  if(lookup.has(key))throw Error('Duplicate album judgments for '+row.query_id);
  lookup.set(key,grade);
 }
 const held=new Set(artifact.model?.provenance?.validation_query_ids||artifact.provenance?.validation_query_ids||[]);
 if(!held.size)throw Error('Model has no query-level held-out validation set');
 const model=artifact.model||artifact;
 const grouped=new Map();
 for(const row of teacher.results||[]){
  if(!held.has(row.query_id))continue;
  const key=identity(row.query_id,row.artist,row.album);
  const group=grouped.get(row.query_id)||[];
  group.push({...row,grade:lookup.get(key)});
  grouped.set(row.query_id,group);
 }
 const perQuery=[],missing=[];
 for(const id of held){
  const group=grouped.get(id)||[];
  if(group.length<k||group.some(r=>r.grade===undefined)){missing.push(id);continue}
  const safe=rankStudent(group,model);
  if(safe.length<k){missing.push(id);continue}
  const baseline=[...group].sort((a,b)=>a.rank-b.rank).slice(0,k);
  const challenger=safe.slice(0,k);
  const teacherRank=[...group].sort((a,b)=>b.teacher_score-a.teacher_score).slice(0,k);
  perQuery.push({
   id,language:group[0].language||'unknown',category:group[0].category||'unknown',
   baseline:ndcg(baseline),student:ndcg(challenger),teacher:ndcg(teacherRank),
  });
 }
 const diffs=perQuery.map(q=>q.student-q.baseline);
 const ci=intervals(diffs);
 const byLanguage={};
 for(const lang of [...new Set(perQuery.map(r=>r.language))]){
  const rows=perQuery.filter(r=>r.language===lang);
  byLanguage[lang]={queries:rows.length,baseline:mean(rows.map(r=>r.baseline)),
    student:mean(rows.map(r=>r.student)),uplift:mean(rows.map(r=>r.student-r.baseline))};
 }
 return {
  basis:'genuine human listening judgments only',
  k,heldout_queries:held.size,fully_judged_queries:perQuery.length,
  missing_or_incomplete_queries:missing,
  baseline_mean_ndcg:mean(perQuery.map(r=>r.baseline)),
  student_mean_ndcg:mean(perQuery.map(r=>r.student)),
  teacher_mean_ndcg:mean(perQuery.map(r=>r.teacher)),
  student_uplift_vs_baseline:mean(diffs),
  uplift_95pct_bootstrap_interval:ci,
  by_language:byLanguage,
  eligible_for_production:false,
  release_gate:{
   enough_heldout_human_judgments:perQuery.length>=minQueries,
   statistically_positive_lift:Boolean(ci&&ci[0]>0),
   non_regression_per_language:Object.values(byLanguage).every(x=>x.uplift>=0),
   note:'Additional latency, privacy and explicit-exclusion gates must pass even if these fields are true.'
  }
 };
}
async function main(){
 const args=process.argv.slice(2);
 const at=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const teacher=at('--teacher'),model=at('--model'),judgments=at('--judgments');
 if(!teacher||!model||!judgments){
  console.error('Usage: node scripts/evaluate-student-human.mjs --teacher scored.json --model student.json --judgments actual-listener-ratings.csv');
  process.exitCode=2;return;
 }
 const files=await Promise.all([teacher,model,judgments].map(p=>fs.readFile(p,'utf8')));
 const report=evaluateHuman(JSON.parse(files[0]),JSON.parse(files[1]),files[2]);
 console.log(JSON.stringify(report,null,2));
 if(at('--output'))await fs.writeFile(at('--output'),JSON.stringify(report,null,2)+'\n');
 if(report.fully_judged_queries===0)process.exitCode=3;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1});
}
