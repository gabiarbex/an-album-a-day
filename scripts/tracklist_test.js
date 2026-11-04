import fs from 'node:fs';
const src=fs.readFileSync('selector.js','utf8');
const start=src.indexOf('function releaseTrackCount');
const end=src.indexOf('async function getReleaseWithRecordings',start);
if(start<0||end<0)throw new Error('tracklist selector helpers missing');
eval(src.slice(start,end));

function release(id,date,count){
 return {id,date,status:'Official',media:[{position:1,'track-count':count,tracks:Array.from({length:count},(_,i)=>({position:i+1,title:'Track '+(i+1)}))}]};
}

// Original-era consensus should beat a later deluxe.
const releases=[
 release('a','1988-09-01',6),
 release('b','1988-10-01',6),
 release('c','1988-11-01',4),
 release('d','2002-01-01',18)
];
const picked=selectRepresentativeRelease(releases,'1988-09-01');
if(picked?.id!=='a')throw new Error('representative release selection failed: '+picked?.id);

// In a frequency tie, prefer the fuller original-era track count.
const tie=[
 release('four','1990-01-01',4),
 release('six','1990-02-01',6)
];
if(selectRepresentativeRelease(tie,'1990-01-01')?.id!=='six')throw new Error('track-count tie should prefer fuller edition');

console.log('PASS tracklist representative-release selection');
