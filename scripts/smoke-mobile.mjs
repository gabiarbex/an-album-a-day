import {chromium} from 'playwright';
import fs from 'node:fs/promises';

const site=process.env.BASELINE_URL||'https://gabiarbex.github.io/an-album-a-day/';
const browser=await chromium.launch({headless:true});
const output={site,checked_at:new Date().toISOString(),viewport:{width:390,height:844}};
let page;
try{
 const context=await browser.newContext({viewport:output.viewport,isMobile:true,hasTouch:true});
 page=await context.newPage();
 await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>!document.querySelector('#recommend')?.disabled,null,{timeout:90000});
 output.initial=await page.evaluate(()=>({
   horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
   submitLabel:document.querySelector('#recommend')?.textContent?.trim()||'',
   textAreaVisible:!!document.querySelector('#feelingInput')?.getClientRects().length
 }));
 await page.locator('#feelingInput').fill('something dreamy, not aggressive');
 await page.locator('#recommend').click();
 await page.waitForFunction(()=>document.body.classList.contains('has-record')&&!!document.querySelector('#details h2'),null,{timeout:90000});
 output.result=await page.evaluate(()=>({
   horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
   title:document.querySelector('#details h2')?.textContent?.trim()||'',
   imageHasSource:!!document.querySelector('#cover')?.getAttribute('src'),
   spotifyEnabled:document.querySelector('#spotify')?.getAttribute('aria-disabled')==='false',
   diarySaveEnabled:!document.querySelector('#log')?.disabled
 }));
 // Browser-level no-repeat check: generate again, then reload.
 const firstId=await page.locator('#details').getAttribute('data-album-id');
 const reroll=page.locator('#reroll');
 if(!firstId||!(await reroll.isVisible()))throw Error('No repeat-testable album or reroll button');
 await reroll.click();
 await page.waitForFunction(previous=>document.querySelector('#details')?.dataset.albumId!==previous,firstId,{timeout:90000});
 const secondId=await page.locator('#details').getAttribute('data-album-id');
 const beforeReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('albumaday.seenKeys.v1')||'[]'));
 await page.screenshot({path:'baseline-results/mobile-result.png',fullPage:true});
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 const afterReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('albumaday.seenKeys.v1')||'[]'));
 output.noRepeat={firstId,secondId,seenBeforeReload:beforeReload.length,seenAfterReload:afterReload.length,
   persisted:beforeReload.every(k=>afterReload.includes(k))};
 if(firstId===secondId||!output.noRepeat.persisted||afterReload.length<2){
   throw Error('No-repeat or seen-history persistence failed');
 }
 if(output.initial.horizontalOverflow>3||output.result.horizontalOverflow>3||
   !output.initial.textAreaVisible||!output.result.spotifyEnabled||!output.result.diarySaveEnabled){
   throw Error('Mobile interactive contract or overflow failed');
 }
 output.ok=true;
 await fs.mkdir('baseline-results',{recursive:true});
}catch(e){output.ok=false;output.error=String(e?.message||e).slice(0,600);process.exitCode=1}
finally{
 await fs.mkdir('baseline-results',{recursive:true});
 await fs.writeFile('baseline-results/mobile-smoke.json',JSON.stringify(output,null,2)+'\n');
 await browser.close();
}
console.log(JSON.stringify(output,null,2));
