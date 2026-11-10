import {chromium} from 'playwright';
import fs from 'node:fs/promises';

const site=process.env.BASELINE_URL||'https://gabiarbex.github.io/an-album-a-day/';
const outDir='baseline-results/editorial';
await fs.mkdir(outDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={site,capturedAt:new Date().toISOString(),label:'Pre-launch editorial browser regression',views:[],ok:false};
let failure=null;

const screens=[
 {label:'desktop',width:1440,height:900,isMobile:false},
 {label:'mobile',width:390,height:844,isMobile:true},
 {label:'small-mobile',width:320,height:700,isMobile:true}
];
try{
 for(const device of screens){
  const context=await browser.newContext({
   viewport:{width:device.width,height:device.height},
   isMobile:device.isMobile,
   hasTouch:device.isMobile,
   reducedMotion:'reduce'
  });
  const page=await context.newPage();
  const entry={label:device.label,viewport:device.width+'×'+device.height};
  try{
   await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>document.querySelector('#recommend')&&!document.querySelector('#recommend').disabled,null,{timeout:90000});
   entry.firstView=await page.evaluate(()=>{
    const css=getComputedStyle(document.body);
    const cover=document.querySelector('#stage');
    const picker=document.querySelector('.picker');
    const heading=document.querySelector('.clerk-intro h2');
    return{
     width:window.innerWidth,
     overflow:Math.max(0,document.documentElement.scrollWidth-window.innerWidth),
     pageBackground:css.backgroundImage,
     pickerBorder:getComputedStyle(picker).borderTopStyle,
     headingFont:getComputedStyle(heading).fontFamily,
     inputVisible:document.querySelector('#feelingInput').getClientRects().length>0,
     heading:heading?.textContent?.trim(),
     editorialAsset:[...document.styleSheets].some(sheet=>/editorial\.css\?v=print-003/.test(sheet.href||'')),
     subtitle:document.querySelector('.masthead p')?.textContent?.trim()||''
    };
   });
   await page.screenshot({path:outDir+'/'+device.label+'-landing.png',fullPage:true});
   if(entry.firstView.overflow>3||!entry.firstView.inputVisible||!entry.firstView.editorialAsset||
      !entry.firstView.headingFont.includes('Georgia')||entry.firstView.pageBackground!=='none')
    throw Error('Visual contract failed: '+JSON.stringify(entry.firstView));
   await page.locator('#feelingInput').fill('i want quiet, reflective bossa nova for a rainy evening. no metal.');
   await page.locator('#fineTune summary').click();
   const mood=page.locator('#moods button').filter({hasText:/^reflective$/i}).first();
   await mood.click();
   entry.controls=await page.evaluate(()=>{
    const el=[...document.querySelectorAll('#moods button')].find(x=>x.textContent.trim()==='reflective');
    return{
     selected:el?.getAttribute('aria-pressed')==='true'||el?.classList.contains('selected'),
     filterOpen:document.querySelector('#fineTune')?.open,
     noteHelp:document.querySelector('#meaningMatchNote')?.textContent.trim()
    };
   });
   if(!entry.controls.selected||!entry.controls.filterOpen||!entry.controls.noteHelp?.includes('album credits'))
    throw Error('Filter control and truthful helper check failed');
   await page.locator('#recommend').click();
   await page.waitForFunction(()=>document.body.classList.contains('has-record')&&
       !!document.querySelector('#details h2')?.textContent?.trim(),null,{timeout:90000});
   entry.result=await page.evaluate(()=>({
    overflow:Math.max(0,document.documentElement.scrollWidth-window.innerWidth),
    album:document.querySelector('#details h2')?.textContent.trim(),
    artist:document.querySelector('#details p')?.textContent.trim(),
    why:document.querySelector('#whyText')?.textContent.trim(),
    visibleWhy:document.querySelector('#whyPanel')?.hidden===false,
    cover:!!document.querySelector('#cover')?.getAttribute('src'),
    spotifyReady:document.querySelector('#spotify')?.getAttribute('aria-disabled')==='false',
    saveReady:!document.querySelector('#log')?.disabled,
    actions:[...document.querySelectorAll('.result-actions button')].filter(x=>!x.hidden).map(x=>x.textContent?.trim()),
    moodTile:getComputedStyle(document.querySelector('.mood-block')).backgroundImage
   }));
   await page.screenshot({path:outDir+'/'+device.label+'-record.png',fullPage:true});
   if(entry.result.overflow>3||!entry.result.album||!entry.result.cover||
      !entry.result.spotifyReady||!entry.result.saveReady||!entry.result.visibleWhy||
      entry.result.moodTile!=='none'||/neural|embeddings?|algorithmic|ai-powered|catalog similarity/i.test(entry.result.why))
    throw Error('Result layout / explanation check failed: '+JSON.stringify(entry.result));
  }catch(error){
   entry.error=String(error?.message||error);
   report.views.push(entry);
   throw error;
  }finally{
   if(!report.views.includes(entry))report.views.push(entry);
   await context.close();
  }
 }
 report.ok=true;
}catch(error){failure=String(error?.stack||error);report.ok=false}
finally{
 await fs.writeFile(outDir+'/report.json',JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
console.log(JSON.stringify(report,null,2));
if(failure){console.error(failure);process.exitCode=1}
