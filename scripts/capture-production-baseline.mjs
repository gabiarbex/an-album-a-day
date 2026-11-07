import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SITE = process.env.BASELINE_URL || 'https://gabiarbex.github.io/an-album-a-day/';
const fixture=JSON.parse(await fs.readFile('benchmarks/intent-100.json','utf8'));
const sampleIds=new Set(['G01','G05','X01','M01','N01','P01','Q01','C01']);
const prompts=fixture.cases.filter(row=>sampleIds.has(row.id));
if(prompts.length!==sampleIds.size)throw new Error('Baseline prompt fixture mismatch');
const browser = await chromium.launch({headless:true});
const results=[];
try {
 for (const {id,prompt,wantGenres,avoidGenres,wantMoods,avoidMoods} of prompts) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  let error='';
  try {
   await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>{const b=document.querySelector('#recommend');return b&&!b.disabled},null,{timeout:80000});
   await page.locator('#feelingInput').fill(prompt);
   await page.locator('#recommend').click();
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
      document.querySelector('#details h2')?.textContent?.trim()!=='pull a record.',null,{timeout:90000});
   await page.waitForTimeout(500);
   const result=await page.evaluate(()=>({
    title:document.querySelector('#details h2')?.textContent?.trim()||'',
    detail:document.querySelector('#details')?.innerText?.trim()||'',
    reason:document.querySelector('#whyText')?.textContent?.trim()||'',
    signals:document.querySelector('#whySignals')?.innerText?.trim()||'',
    status:document.querySelector('#status')?.textContent?.trim()||'',
    catalog:({...document.querySelector('#details')?.dataset}),
    page:location.href
   }));
   results.push({id,prompt,wantGenres,avoidGenres,wantMoods,avoidMoods,...result,ok:true});
  }catch(e){
   error=String(e?.message||e).slice(0,450);
   results.push({id,prompt,wantGenres,avoidGenres,wantMoods,avoidMoods,ok:false,error,status:await page.locator('#status').textContent().catch(()=>null)});
  }finally{await context.close()}
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{await browser.close()}
await fs.mkdir('baseline-results',{recursive:true});
await fs.writeFile('baseline-results/production-top1.json',JSON.stringify({
 captured_at:new Date().toISOString(),site:SITE,
 note:'Observed top-1 outputs only; no relevance judgments or NDCG are inferred.',
 results
},null,2)+'\n');
if(results.filter(r=>r.ok).length<4)process.exitCode=1;
