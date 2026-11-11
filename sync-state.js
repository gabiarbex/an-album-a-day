/* One deterministic merge for Premium cloud sync; no browser dependencies. */
(function(root){
'use strict';
const norm=v=>String(v||'').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const uniq=(values,limit=150000)=>{
 const out=[],seen=new Set();
 for(const raw of values||[]){
  const v=String(raw||'').trim();if(!v||seen.has(v))continue;
  seen.add(v);out.push(v);if(out.length>=limit)break;
 }
 return out;
};
function diaryKey(entry){
 return [String(entry?.date||''),norm(entry?.artist),norm(entry?.album)].join('::');
}
function timestamp(entry){
 const time=Date.parse(entry?.updated_at||entry?.completed_at||entry?.picked_at||'');
 return Number.isFinite(time)?time:0;
}
function quality(entry){
 return Number(Boolean(entry?.rating))*2+
  Number(Boolean(entry?.completed))+
  Number(Boolean(entry?.favorite_track))+
  Number(Boolean(entry?.notes))*2+
  Number(Boolean(entry?.signal_snapshot));
}
function chooseEntry(a,b){
 if(!a)return b;
 if(!b)return a;
 const aTime=timestamp(a),bTime=timestamp(b);
 if(aTime!==bTime)return aTime>bTime?a:b;
 const aQuality=quality(a),bQuality=quality(b);
 if(aQuality!==bQuality)return aQuality>bQuality?a:b;
 return b; // preserve local edits when evidence is otherwise equivalent
}
function mergeDiary(remote,local,deleted=new Set()){
 const map=new Map();
 for(const entry of remote||[]){
  if(!entry||typeof entry!=='object'||!entry.artist||!entry.album)continue;
  map.set(diaryKey(entry),chooseEntry(map.get(diaryKey(entry)),entry));
 }
 for(const entry of local||[]){
  if(!entry||typeof entry!=='object'||!entry.artist||!entry.album)continue;
  map.set(diaryKey(entry),chooseEntry(map.get(diaryKey(entry)),entry));
 }
 for(const key of deleted)map.delete(String(key));
 return [...map.values()].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
}
function mergeState(remote={},local={},options={}){
 remote=remote||{};local=local||{};
 const deleted=new Set(uniq([...(remote.deletedDiaryKeys||remote.deleted_diary_keys||[]),
  ...(local.deletedDiaryKeys||local.deleted_diary_keys||[])]));
 const lastfmRemote=remote.lastfmProfile||remote.lastfm_profile||null;
 const lastfmLocal=local.lastfmProfile||local.lastfm_profile||null;
 const remoteUpdated=Date.parse(lastfmRemote?.imported_at||'')||0;
 const localUpdated=Date.parse(lastfmLocal?.imported_at||'')||0;
 const lastfm=options.localDirty&&lastfmLocal?lastfmLocal:
  !lastfmLocal?lastfmRemote:!lastfmRemote?lastfmLocal:
  remoteUpdated>localUpdated?lastfmRemote:lastfmLocal;
 return {
  diary:mergeDiary(remote.diary,local.diary,deleted),
  deletedDiaryKeys:[...deleted].slice(-1000),
  seenKeys:uniq([...(remote.seenKeys||remote.seen_keys||[]),...(local.seenKeys||local.seen_keys||[])]),
  recentArtists:uniq([...(remote.recentArtists||remote.recent_artists||[]),...(local.recentArtists||local.recent_artists||[])]
   .map(norm).filter(Boolean),36).slice(-18),
  pickDays:uniq([...(remote.pickDays||remote.pick_days||[]),...(local.pickDays||local.pick_days||[])])
   .sort().slice(-730),
  lastfmProfile:lastfm?JSON.parse(JSON.stringify(lastfm)):null
 };
}
root.AlbumSyncState={mergeDiary,mergeState,diaryKey,version:'conflict-safe-v2'};
})(globalThis);
