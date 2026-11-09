import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SITE = process.env.BASELINE_URL || 'https://gabiarbex.github.io/an-album-a-day/';
const fixture=JSON.parse(await fs.readFile('benchmarks/intent-100.json','utf8'));
const sampleIds=new Set(['G01','G05','X01','M01','N01','P01','Q01','C01']);
const goalScenarios=JSON.parse(await fs.readFile('benchmarks/emotional-goals.json','utf8'));
const globalScenarios=JSON.parse(await fs.readFile('benchmarks/global-requests.json','utf8'));
const extraFixture=process.env.BENCHMARK_CASES_FILE
  ? JSON.parse(await fs.readFile(process.env.BENCHMARK_CASES_FILE,'utf8'))
  : null;
const prompts=extraFixture?.cases ||
  [...fixture.cases.filter(row=>sampleIds.has(row.id)),...goalScenarios.cases,...globalScenarios.cases];
if(!prompts.length||new Set(prompts.map(row=>row.id)).size!==prompts.length||
  (!extraFixture&&prompts.length!==sampleIds.size+goalScenarios.cases.length+globalScenarios.cases.length))
  throw new Error('Baseline prompt fixture mismatch');
const browser = await chromium.launch({headless:true});
const results=[];
try {
 for (const {id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,uiMoods,uiEnergy,uiComfort,expectNarrative} of prompts) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  // Fixed per-prompt salt makes shard loading, daily seeds and client taste
  // identity repeatable across algorithm versions. Each case has its own
  // isolated browser context, so seen-history still starts empty.
  await page.addInitScript(seed=>{
    try{localStorage.setItem('albumaday.salt',seed)}catch{}
  },'albumaday-benchmark-fixed-v1-'+id);
  let error='';
  let backendObservation=null;
  page.on('response',response=>{
    if(!/\/api\/recommend(?:\?|$)/.test(response.url()))return;
    // Persist public album metadata, never request client IDs or taste signals.
    backendObservation=(async()=>{
      if(!response.ok())return {ok:false,status:response.status()};
      const [reply,request]=await Promise.all([response.json(),Promise.resolve(response.request().postDataJSON())]);
      const albums=new Map((request?.candidates||[]).map(a=>[String(a.id),a]));
      return {
        ok:true,engine:reply.engine||'',diagnostics:reply.diagnostics||{},
        alternatives:(reply.alternatives||[]).map((row,i)=>{
          const a=albums.get(String(row.id))||{};
          return {rank:i+1,id:String(row.id),artist:String(a.artist||''),title:String(a.title||''),
            genres:a.genres||[],tags:(a.tags||[]).slice(0,12),moods:a.moods||[],
            score:row.score,neural:row.neural,
            profileQuality:a.profileQuality??null,
            moodSource:a.moodSource||'',
            energySource:a.energySource||'',energyConfidence:a.energyConfidence??null,
            energy:a.energy??null,originCountry:a.originCountry||null,
            vocalLanguages:a.vocalLanguages||[]};
        })
      };
    })().catch(e=>({ok:false,error:String(e).slice(0,160)}));
  });
  try {
   await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>{const b=document.querySelector('#recommend');return b&&!b.disabled},null,{timeout:80000});
   await page.locator('#feelingInput').fill(prompt);
   if((uiMoods||[]).length||uiEnergy||uiComfort)await page.locator('#fineTune summary').click();
   for(const tag of uiMoods||[]){
    const moodButton=page.locator('#moods button').filter({hasText:tag}).first();
    await moodButton.evaluate(button=>button.click());
   }
   if(uiEnergy)await page.locator('#energy button').filter({hasText:uiEnergy}).first().click();
   if(uiComfort)await page.locator('#comfort button').filter({hasText:uiComfort}).first().click();
   await page.locator('#recommend').click();
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
      document.querySelector('#details h2')?.textContent?.trim()!=='pull a record.',null,{timeout:90000});
   await page.waitForTimeout(500);
   const backend=backendObservation?await backendObservation:null;
   const result=await page.evaluate(()=>({
    frontend:{
      fusionAvailable:Boolean(globalThis.AlbumFusion?.select),
      intent:(()=>{
        const note=document.querySelector('#feelingInput')?.value||'';
        const v=globalThis.AlbumIntent?.interpretFeeling?.(note);
        return v?{goalShift:Boolean(v.goalShift),moods:Object.keys(v.moods||{}),
          avoidedMoods:Object.keys(v.avoidMoods||{}),
          genres:v.genres||[],avoidedGenres:v.avoidGenres||[],
          energy:v.energy,queryLanguage:v.queryLanguage,
          narrativeKind:v.narrativeKind||null,narrativeThemes:v.narrativeThemes||[],
          originCountries:v.originCountries||[],avoidedOriginCountries:v.avoidOriginCountries||[],
          vocalLanguages:v.vocalLanguages||[]}:null;
      })(),
      scripts:[...document.scripts].map(node=>node.src)
        .filter(src=>/selector\.js|intent-core\.js|retrieval-fusion\.js|album-locale\.js|geo-catalog\.js/.test(src))
        .map(src=>{try{const url=new URL(src);return url.pathname+url.search}catch{return src}})
    },
    title:document.querySelector('#details h2')?.textContent?.trim()||'',
    detail:document.querySelector('#details')?.innerText?.trim()||'',
    reason:document.querySelector('#whyText')?.textContent?.trim()||'',
    signals:document.querySelector('#whySignals')?.innerText?.trim()||'',
    status:document.querySelector('#status')?.textContent?.trim()||'',
    catalog:({...document.querySelector('#details')?.dataset}),
    page:location.href
   }));
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,uiMoods,uiEnergy,uiComfort,expectNarrative,...result,backend,ok:true});
  }catch(e){
   error=String(e?.message||e).slice(0,450);
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,uiMoods,uiEnergy,uiComfort,expectNarrative,ok:false,error,status:await page.locator('#status').textContent().catch(()=>null)});
  }finally{await context.close()}
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{await browser.close()}
await fs.mkdir('baseline-results',{recursive:true});
await fs.writeFile(process.env.BENCHMARK_OUTPUT || 'baseline-results/production-top1.json',JSON.stringify({
 captured_at:new Date().toISOString(),site:SITE,
 seed_policy:'stable per prompt albumaday-benchmark-fixed-v1 ID',
 note:'Observed top-one and up-to-five backend alternatives; no listening relevance judgments are inferred.',
 results
},null,2)+'\n');
// Reviewer rows stay unrated until a person actually listens and scores them.
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const review=[['query_id','rank','artist','album','relevance','exclusion_violation','already_seen']];
for(const row of results){
  if(!row.ok)continue;
  const alternatives=row.backend?.alternatives?.length
    ? row.backend.alternatives
    : [{rank:1,artist:(row.detail||'').split('\n').find(t=>t.includes(' · '))?.split(' · ')[0]||'',title:row.title}];
  for(const album of alternatives)review.push([row.id,album.rank,album.artist,album.title,'','','']);
}
await fs.writeFile('baseline-results/review-sheet.csv',
 review.map(row=>row.map(csvCell).join(',')).join('\n')+'\n');

if(results.filter(r=>r.ok).length<4)process.exitCode=1;
,'i')}).first();
    await moodButton.evaluate(button=>button.click());
   }
   if(uiEnergy)await page.locator('#energy button').filter({hasText:new RegExp('^'+uiEnergy+'
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
      document.querySelector('#details h2')?.textContent?.trim()!=='pull a record.',null,{timeout:90000});
   await page.waitForTimeout(500);
   const backend=backendObservation?await backendObservation:null;
   const result=await page.evaluate(()=>({
    frontend:{
      fusionAvailable:Boolean(globalThis.AlbumFusion?.select),
      intent:(()=>{
        const note=document.querySelector('#feelingInput')?.value||'';
        const v=globalThis.AlbumIntent?.interpretFeeling?.(note);
        return v?{goalShift:Boolean(v.goalShift),moods:Object.keys(v.moods||{}),
          avoidedMoods:Object.keys(v.avoidMoods||{}),
          genres:v.genres||[],avoidedGenres:v.avoidGenres||[],
          energy:v.energy,queryLanguage:v.queryLanguage,
          originCountries:v.originCountries||[],avoidedOriginCountries:v.avoidOriginCountries||[],
          vocalLanguages:v.vocalLanguages||[]}:null;
      })(),
      scripts:[...document.scripts].map(node=>node.src)
        .filter(src=>/selector\.js|intent-core\.js|retrieval-fusion\.js|album-locale\.js|geo-catalog\.js/.test(src))
        .map(src=>{try{const url=new URL(src);return url.pathname+url.search}catch{return src}})
    },
    title:document.querySelector('#details h2')?.textContent?.trim()||'',
    detail:document.querySelector('#details')?.innerText?.trim()||'',
    reason:document.querySelector('#whyText')?.textContent?.trim()||'',
    signals:document.querySelector('#whySignals')?.innerText?.trim()||'',
    status:document.querySelector('#status')?.textContent?.trim()||'',
    catalog:({...document.querySelector('#details')?.dataset}),
    page:location.href
   }));
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,...result,backend,ok:true});
  }catch(e){
   error=String(e?.message||e).slice(0,450);
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,ok:false,error,status:await page.locator('#status').textContent().catch(()=>null)});
  }finally{await context.close()}
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{await browser.close()}
await fs.mkdir('baseline-results',{recursive:true});
await fs.writeFile(process.env.BENCHMARK_OUTPUT || 'baseline-results/production-top1.json',JSON.stringify({
 captured_at:new Date().toISOString(),site:SITE,
 seed_policy:'stable per prompt albumaday-benchmark-fixed-v1 ID',
 note:'Observed top-one and up-to-five backend alternatives; no listening relevance judgments are inferred.',
 results
},null,2)+'\n');
// Reviewer rows stay unrated until a person actually listens and scores them.
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const review=[['query_id','rank','artist','album','relevance','exclusion_violation','already_seen']];
for(const row of results){
  if(!row.ok)continue;
  const alternatives=row.backend?.alternatives?.length
    ? row.backend.alternatives
    : [{rank:1,artist:(row.detail||'').split('\n').find(t=>t.includes(' · '))?.split(' · ')[0]||'',title:row.title}];
  for(const album of alternatives)review.push([row.id,album.rank,album.artist,album.title,'','','']);
}
await fs.writeFile('baseline-results/review-sheet.csv',
 review.map(row=>row.map(csvCell).join(',')).join('\n')+'\n');

if(results.filter(r=>r.ok).length<4)process.exitCode=1;
,'i')}).first().click();
   if(uiComfort)await page.locator('#comfort button').filter({hasText:new RegExp('^'+uiComfort+'
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
      document.querySelector('#details h2')?.textContent?.trim()!=='pull a record.',null,{timeout:90000});
   await page.waitForTimeout(500);
   const backend=backendObservation?await backendObservation:null;
   const result=await page.evaluate(()=>({
    frontend:{
      fusionAvailable:Boolean(globalThis.AlbumFusion?.select),
      intent:(()=>{
        const note=document.querySelector('#feelingInput')?.value||'';
        const v=globalThis.AlbumIntent?.interpretFeeling?.(note);
        return v?{goalShift:Boolean(v.goalShift),moods:Object.keys(v.moods||{}),
          avoidedMoods:Object.keys(v.avoidMoods||{}),
          genres:v.genres||[],avoidedGenres:v.avoidGenres||[],
          energy:v.energy,queryLanguage:v.queryLanguage,
          originCountries:v.originCountries||[],avoidedOriginCountries:v.avoidOriginCountries||[],
          vocalLanguages:v.vocalLanguages||[]}:null;
      })(),
      scripts:[...document.scripts].map(node=>node.src)
        .filter(src=>/selector\.js|intent-core\.js|retrieval-fusion\.js|album-locale\.js|geo-catalog\.js/.test(src))
        .map(src=>{try{const url=new URL(src);return url.pathname+url.search}catch{return src}})
    },
    title:document.querySelector('#details h2')?.textContent?.trim()||'',
    detail:document.querySelector('#details')?.innerText?.trim()||'',
    reason:document.querySelector('#whyText')?.textContent?.trim()||'',
    signals:document.querySelector('#whySignals')?.innerText?.trim()||'',
    status:document.querySelector('#status')?.textContent?.trim()||'',
    catalog:({...document.querySelector('#details')?.dataset}),
    page:location.href
   }));
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,...result,backend,ok:true});
  }catch(e){
   error=String(e?.message||e).slice(0,450);
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,ok:false,error,status:await page.locator('#status').textContent().catch(()=>null)});
  }finally{await context.close()}
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{await browser.close()}
await fs.mkdir('baseline-results',{recursive:true});
await fs.writeFile(process.env.BENCHMARK_OUTPUT || 'baseline-results/production-top1.json',JSON.stringify({
 captured_at:new Date().toISOString(),site:SITE,
 seed_policy:'stable per prompt albumaday-benchmark-fixed-v1 ID',
 note:'Observed top-one and up-to-five backend alternatives; no listening relevance judgments are inferred.',
 results
},null,2)+'\n');
// Reviewer rows stay unrated until a person actually listens and scores them.
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const review=[['query_id','rank','artist','album','relevance','exclusion_violation','already_seen']];
for(const row of results){
  if(!row.ok)continue;
  const alternatives=row.backend?.alternatives?.length
    ? row.backend.alternatives
    : [{rank:1,artist:(row.detail||'').split('\n').find(t=>t.includes(' · '))?.split(' · ')[0]||'',title:row.title}];
  for(const album of alternatives)review.push([row.id,album.rank,album.artist,album.title,'','','']);
}
await fs.writeFile('baseline-results/review-sheet.csv',
 review.map(row=>row.map(csvCell).join(',')).join('\n')+'\n');

if(results.filter(r=>r.ok).length<4)process.exitCode=1;
,'i')}).first().click();
   await page.locator('#recommend').click();
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
      document.querySelector('#details h2')?.textContent?.trim()!=='pull a record.',null,{timeout:90000});
   await page.waitForTimeout(500);
   const backend=backendObservation?await backendObservation:null;
   const result=await page.evaluate(()=>({
    frontend:{
      fusionAvailable:Boolean(globalThis.AlbumFusion?.select),
      intent:(()=>{
        const note=document.querySelector('#feelingInput')?.value||'';
        const v=globalThis.AlbumIntent?.interpretFeeling?.(note);
        return v?{goalShift:Boolean(v.goalShift),moods:Object.keys(v.moods||{}),
          avoidedMoods:Object.keys(v.avoidMoods||{}),
          genres:v.genres||[],avoidedGenres:v.avoidGenres||[],
          energy:v.energy,queryLanguage:v.queryLanguage,
          originCountries:v.originCountries||[],avoidedOriginCountries:v.avoidOriginCountries||[],
          vocalLanguages:v.vocalLanguages||[]}:null;
      })(),
      scripts:[...document.scripts].map(node=>node.src)
        .filter(src=>/selector\.js|intent-core\.js|retrieval-fusion\.js|album-locale\.js|geo-catalog\.js/.test(src))
        .map(src=>{try{const url=new URL(src);return url.pathname+url.search}catch{return src}})
    },
    title:document.querySelector('#details h2')?.textContent?.trim()||'',
    detail:document.querySelector('#details')?.innerText?.trim()||'',
    reason:document.querySelector('#whyText')?.textContent?.trim()||'',
    signals:document.querySelector('#whySignals')?.innerText?.trim()||'',
    status:document.querySelector('#status')?.textContent?.trim()||'',
    catalog:({...document.querySelector('#details')?.dataset}),
    page:location.href
   }));
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,...result,backend,ok:true});
  }catch(e){
   error=String(e?.message||e).slice(0,450);
   results.push({id,prompt,category,language,wantGenres,avoidGenres,wantMoods,avoidMoods,wantCountries,avoidCountries,wantVocals,ok:false,error,status:await page.locator('#status').textContent().catch(()=>null)});
  }finally{await context.close()}
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{await browser.close()}
await fs.mkdir('baseline-results',{recursive:true});
await fs.writeFile(process.env.BENCHMARK_OUTPUT || 'baseline-results/production-top1.json',JSON.stringify({
 captured_at:new Date().toISOString(),site:SITE,
 seed_policy:'stable per prompt albumaday-benchmark-fixed-v1 ID',
 note:'Observed top-one and up-to-five backend alternatives; no listening relevance judgments are inferred.',
 results
},null,2)+'\n');
// Reviewer rows stay unrated until a person actually listens and scores them.
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const review=[['query_id','rank','artist','album','relevance','exclusion_violation','already_seen']];
for(const row of results){
  if(!row.ok)continue;
  const alternatives=row.backend?.alternatives?.length
    ? row.backend.alternatives
    : [{rank:1,artist:(row.detail||'').split('\n').find(t=>t.includes(' · '))?.split(' · ')[0]||'',title:row.title}];
  for(const album of alternatives)review.push([row.id,album.rank,album.artist,album.title,'','','']);
}
await fs.writeFile('baseline-results/review-sheet.csv',
 review.map(row=>row.map(csvCell).join(',')).join('\n')+'\n');

if(results.filter(r=>r.ok).length<4)process.exitCode=1;
