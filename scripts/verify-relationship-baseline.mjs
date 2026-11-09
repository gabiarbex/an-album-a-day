#!/usr/bin/env node
// Safeguard musical coherence for synthetic relationship/goal-shift scenarios.
// This is NOT human listening judgment and never sees real private diaries.
import fs from 'node:fs/promises';

const source=process.argv[2]||'baseline-results/relationship-observed.json';
const payload=JSON.parse(await fs.readFile(source,'utf8'));
const results=(payload.results||[]).filter(x=>String(x.id||'').startsWith('R'));
const report={
 captured_at:payload.captured_at,
 total:results.length,completed:results.filter(x=>x.ok).length,
 narrative_correct:0,expected_moods_detected:0,
 blatant_low_energy_style_mismatches:[],unobserved:[],
 actual:[]
};
for(const row of results){
 const intent=row.frontend?.intent||{};
 const narrative=(intent.narrativeKind||null)===(row.expectNarrative||null);
 if(narrative)report.narrative_correct++;
 const moods=(row.wantMoods||[]).every(m=>(intent.moods||[]).includes(m));
 if(moods)report.expected_moods_detected++;
 const selected=row.backend?.alternatives?.[0];
 const styles=[...(selected?.genres||[]),...(selected?.tags||[])].map(x=>String(x).toLowerCase());
 const dance=styles.some(s=>/^(disco|jazz-funk|dance-pop|party|happy hardcore|gabber)$/.test(s));
 const quiet=styles.some(s=>/slowcore|sadcore|acoustic|indie folk|singer.songwriter|chamber pop|melanchol|reflective|dream pop|ambient/.test(s));
 const mismatch=row.expectNarrative&&row.uiEnergy==='low'&&dance&&!quiet;
 if(mismatch)report.blatant_low_energy_style_mismatches.push(row.id);
 if(!row.ok||!selected)report.unobserved.push({id:row.id,error:row.error||'No backend candidates'});
 report.actual.push({
  id:row.id,ok:row.ok,title:row.title,artist:selected?.artist||null,
  genres:selected?.genres||[],narrative:intent.narrativeKind||null,
  stated_moods:intent.moods||[],reason:row.reason||'',lowEnergyMismatch:Boolean(mismatch)
 });
}
report.caveat='This only measures coarse metadata contradictions. It does not verify mood, lyrics, sound, or actual listener relevance.';
console.log(JSON.stringify(report,null,2));
if(report.total<6||report.completed<6||
 report.narrative_correct!==report.total||
 report.expected_moods_detected!==report.total||
 report.unobserved.length||
 report.blatant_low_energy_style_mismatches.length){
 console.error('Relationship recommendation regression: inspect actual album metadata and ranking.');
 process.exitCode=1;
}
