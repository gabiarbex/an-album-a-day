#!/usr/bin/env node
// Active review: prioritize real prompt disagreements and ambiguity; never
// manufacture relevance labels or expose model predictions to listeners.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const avgEntropy=rows=>{
 if(rows.length<2)return 0;
 const vals=rows.map(r=>r.teacher_score);
 const max=Math.max(...vals),range=Math.max(.001,max-Math.min(...vals));
 const exp=vals.map(x=>Math.exp((x-max)/range*3));
 const total=exp.reduce((a,b)=>a+b,0),p=exp.map(v=>v/total);
 return -p.reduce((s,x)=>s+x*Math.log(Math.max(1e-10,x)),0)/Math.log(p.length);
};

export function selectReviewQueue(observed,teacher,{limit=20}={}){
 const truth=new Map();
 for(const row of teacher?.results||[]){
  if(!Number.isFinite(row.teacher_score))throw Error('Teacher scores required for active review');
  const bucket=truth.get(row.query_id)||[];bucket.push(row);truth.set(row.query_id,bucket);
 }
 const scored=[];
 for(const query of observed?.results||[]){
  if(!query.ok||!query.backend?.alternatives?.length)continue;
  const pairs=truth.get(query.id)||[];
  if(pairs.length<2)continue;
  const teacherFirst=[...pairs].sort((a,b)=>b.teacher_score-a.teacher_score||a.rank-b.rank)[0];
  const baseline=pairs.find(x=>Number(x.rank)===1);
  if(!baseline)continue;
  const disagreement=String(teacherFirst.album_id)!==String(baseline.album_id);
  const uncertainty=avgEntropy(pairs);
  const language=String(query.language||pairs[0].language||'unknown').toLowerCase();
  const category=String(query.category||pairs[0].category||'other');
  const emotional=/emotion|mood|narrative/.test(category);
  const priority=(disagreement?2:0)+uncertainty+(emotional?.2:0);
  scored.push({query,language,category,disagreement,uncertainty,priority});
 }
 if(!scored.length)throw Error('No real teacher–baseline comparisons found');
 scored.sort((a,b)=>b.priority-a.priority||String(a.query.id).localeCompare(String(b.query.id)));
 const groups=new Map();
 for(const row of scored){
  if(!groups.has(row.language))groups.set(row.language,[]);
  groups.get(row.language).push(row);
 }
 const selected=[],seen=new Set(),max=Math.max(1,Math.floor(Number(limit)||20));
 const languages=[...groups.keys()].sort();
 // Fair coverage: first cycle through language groups before global fill.
 let progress=true;
 while(selected.length<max&&progress){
  progress=false;
  for(const lang of languages){
   const next=(groups.get(lang)||[]).find(x=>!seen.has(x.query.id));
   if(!next||selected.length>=max)continue;
   selected.push(next);seen.add(next.query.id);progress=true;
  }
 }
 for(const row of scored){
  if(selected.length>=max)break;
  if(!seen.has(row.query.id)){selected.push(row);seen.add(row.query.id)}
 }
 return {
  captured_at:observed.captured_at,
  source_kind:'real_recommender_observations_active_review_queue',
  generated_from_teacher:teacher.model||'unspecified',
  selected_queries:selected.length,
  teacher_baseline_disagreements:selected.filter(x=>x.disagreement).length,
  by_language:Object.fromEntries(languages.map(lang=>[lang,selected.filter(x=>x.language===lang).length])),
  privacy:'Public synthetic listening prompts and album metadata only; no judgment is included.',
  selection_note:'High priority = teacher-baseline disagreement, score ambiguity and emotional use case. Ratings must come from a human listener.',
  results:selected.map(row=>row.query),
 };
}
async function main(){
 const args=process.argv.slice(2);
 const at=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const observed=at('--observed'),teacher=at('--teacher'),output=at('--output');
 if(!observed||!teacher||!output){
  console.error('Usage: node scripts/select-active-review.mjs --observed captured.json --teacher scored.json --output active-review.json [--limit 20]');
  process.exitCode=2;return;
 }
 const [a,b]=await Promise.all([observed,teacher].map(path=>fs.readFile(path,'utf8')));
 const result=selectReviewQueue(JSON.parse(a),JSON.parse(b),{limit:Number(at('--limit'))||20});
 await fs.writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
 console.log(JSON.stringify({selected:result.selected_queries,disagreements:result.teacher_baseline_disagreements,by_language:result.by_language,output},null,2));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1});
}
