#!/usr/bin/env node
// CPU-only quantized multilingual teacher experiment. Never runs on site visitors.
// Uses only publicly captured prompts and catalog metadata. No private diaries.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const DEFAULT_MODEL='SugoLabs/mmarco-mMiniLMv2-L12-H384-v1';

export function verifyPairs(payload){
 const rows=payload?.results;
 if(!Array.isArray(rows)||rows.length<2)throw Error('No captured candidate pairs');
 const groupCount=new Map();
 for(const row of rows){
  if(!row.query_id||!row.prompt||!row.passage||!row.album_id||!row.artist||!row.album)
   throw Error('Incomplete public candidate pair');
  if(typeof row.prompt!=='string'||row.prompt.length>1100)throw Error('Invalid prompt');
  if(typeof row.passage!=='string'||row.passage.length>1500)throw Error('Invalid passage');
  groupCount.set(row.query_id,(groupCount.get(row.query_id)||0)+1);
 }
 if([...groupCount.values()].some(n=>n<2))throw Error('Each prompt needs at least two real candidates');
 return {queries:groupCount.size,pairs:rows.length,languages:[
  ...new Set(rows.map(row=>row.language||'unknown'))]};
}

export async function teacherScore(payload,options={}){
 const counts=verifyPairs(payload);
 const modelId=options.model||DEFAULT_MODEL;
 const batchSize=Math.max(1,Math.min(16,Number(options.batchSize)||8));
 const {AutoTokenizer,AutoModelForSequenceClassification}=await import('@huggingface/transformers');
 const tokenizer=await AutoTokenizer.from_pretrained(modelId);
 const model=await AutoModelForSequenceClassification.from_pretrained(modelId,{
  dtype:'q8',device:'cpu',
 });
 const start=performance.now();
 const scored=[];
 for(let from=0;from<payload.results.length;from+=batchSize){
  const batch=payload.results.slice(from,from+batchSize);
  const input=tokenizer(batch.map(row=>row.prompt),{
   text_pair:batch.map(row=>row.passage),
   padding:true,truncation:true,max_length:384,
  });
  const output=await model(input);
  const logits=output.logits.tolist();
  if(!Array.isArray(logits)||logits.length!==batch.length)throw Error('Teacher tensor shape mismatch');
  batch.forEach((row,i)=>{
   const value=Array.isArray(logits[i])?logits[i][0]:logits[i];
   if(!Number.isFinite(Number(value)))throw Error('Non-finite teacher logit');
   const {passage,...metadata}=row;
   scored.push({...metadata,teacher_score:Number(value)});
  });
 }
 const byQuery=new Map();
 for(const row of scored){
  const group=byQuery.get(row.query_id)||[];
  group.push(row);byQuery.set(row.query_id,group);
 }
 let teacherTop1Differs=0;
 for(const group of byQuery.values()){
  const order=[...group].sort((a,b)=>b.teacher_score-a.teacher_score||a.rank-b.rank);
  order.forEach((row,i)=>{row.teacher_rank=i+1});
  if(order[0].rank!==1)teacherTop1Differs++;
 }
 return {
  mode:'scored',model:modelId,
  source:payload.source||'public baseline pairs',
  counts,
  diagnostics:{
   total_inference_ms:Math.round(performance.now()-start),
   teacher_top1_disagreements_with_existing_engine:teacherTop1Differs,
   query_count:byQuery.size,
  },
  note:'Teacher logit is an automated text-ranking signal, never a human musical relevance grade.',
  results:scored,
 };
}
async function main(){
 const args=process.argv.slice(2);
 const at=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const pairsPath=at('--pairs'),output=at('--output');
 if(!pairsPath){
  console.error('Usage: node scripts/score-teacher-onnx.mjs --pairs public-pairs.json [--score --output scores.json]');
  process.exitCode=2;return;
 }
 const payload=JSON.parse(await fs.readFile(pairsPath,'utf8'));
 const check=verifyPairs(payload);
 if(!args.includes('--score')){
  console.log(JSON.stringify({mode:'unscored-check',...check,model_not_downloaded:true},null,2));
  return;
 }
 if(!output)throw Error('Provide --output when using --score');
 const scored=await teacherScore(payload,{batchSize:Number(at('--batch-size'))||8,model:at('--model')||DEFAULT_MODEL});
 await fs.writeFile(output,JSON.stringify(scored,null,2)+'\n');
 console.log(JSON.stringify({saved:output,model:scored.model,counts:scored.counts,diagnostics:scored.diagnostics},null,2));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(err=>{console.error(String(err?.stack||err));process.exitCode=1});
}
