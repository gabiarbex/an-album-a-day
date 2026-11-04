(()=>{
'use strict';

const CONFIG=window.ALBUM_AUTH_CONFIG||{};
const TABLE='user_sync_state';
const MIGRATION_PREFIX='albumaday.cloudMigrated.v1:';
const LAST_SYNC_PREFIX='albumaday.cloudLastSync.v1:';
const $=id=>document.getElementById(id);

let client=null;
let session=null;
let syncing=false;
let syncTimer=null;
let dirty=false;
let initialized=false;

function toast(message){
 if(typeof window.showToast==='function')window.showToast(message);
 else{
  const node=$('toast');
  if(node){node.textContent=message;node.hidden=false;setTimeout(()=>{node.hidden=true},2400)}
 }
}
function pickerApi(){return window.AlbumPickerSync||null}
function normalizeArtist(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ')}
function diaryKey(entry){
 return [
  String(entry?.date||''),
  normalizeArtist(entry?.artist),
  String(entry?.album||'').trim().toLowerCase().replace(/\s+/g,' ')
 ].join('::');
}
function uniq(values,limit=100000){
 const out=[],seen=new Set();
 for(const value of values||[]){
  const key=String(value||'').trim();
  if(!key||seen.has(key))continue;
  seen.add(key);out.push(key);
  if(out.length>=limit)break;
 }
 return out;
}
function mergeDiary(remote,local,deleted){
 const map=new Map();
 for(const entry of remote||[])if(entry&&typeof entry==='object')map.set(diaryKey(entry),entry);
 for(const entry of local||[])if(entry&&typeof entry==='object')map.set(diaryKey(entry),entry);
 for(const key of deleted)map.delete(String(key));
 return [...map.values()].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
}
function cloudLastfm(profile){
 if(!profile||typeof profile!=='object')return null;
 return {
  version:Number(profile.version)||1,
  total_scrobbles:Number(profile.total_scrobbles)||0,
  unique_artists:Number(profile.unique_artists)||0,
  artists:Array.isArray(profile.artists)?profile.artists.slice(0,2000):[],
  neighbors:Array.isArray(profile.neighbors)?profile.neighbors.slice(0,120):[],
  imported_at:profile.imported_at||null,
  neighbor_source:profile.neighbor_source||null,
  neighbor_seed_count:Number(profile.neighbor_seed_count)||0,
  neighbor_updated_at:profile.neighbor_updated_at||null
 };
}
function mergeState(remote,local){
 const deleted=new Set([
  ...(remote?.deletedDiaryKeys||remote?.deleted_diary_keys||[]),
  ...(local?.deletedDiaryKeys||[])
 ].map(String));
 const recent=uniq([
  ...(remote?.recentArtists||remote?.recent_artists||[]),
  ...(local?.recentArtists||[])
 ].map(normalizeArtist).filter(Boolean),36).slice(-18);
 const pickDays=uniq([
  ...(remote?.pickDays||remote?.pick_days||[]),
  ...(local?.pickDays||[])
 ]).sort().slice(-730);
 const seenKeys=uniq([
  ...(remote?.seenKeys||remote?.seen_keys||[]),
  ...(local?.seenKeys||[])
 ]);
 return {
  diary:mergeDiary(remote?.diary||[],local?.diary||[],deleted),
  deletedDiaryKeys:[...deleted].slice(-1000),
  seenKeys,
  recentArtists:recent,
  pickDays,
  lastfmProfile:dirty
   ? cloudLastfm(local?.lastfmProfile||null)
   : cloudLastfm(local?.lastfmProfile||remote?.lastfm_profile||remote?.lastfmProfile||null)
 };
}
function migrationKey(){return session?.user?.id?MIGRATION_PREFIX+session.user.id:null}
function hasMigrated(){
 const key=migrationKey();
 try{return key?localStorage.getItem(key)==='1':false}catch{return false}
}
function setMigrated(){
 const key=migrationKey();
 try{if(key)localStorage.setItem(key,'1')}catch{}
}
function readLocal(){
 const api=pickerApi();
 if(api?.exportState)return api.exportState();
 try{
  return {
   diary:JSON.parse(localStorage.getItem('albumaday.logs')||'[]'),
   deletedDiaryKeys:JSON.parse(localStorage.getItem('albumaday.diaryDeleted.v1')||'[]'),
   seenKeys:JSON.parse(localStorage.getItem('albumaday.seenKeys.v1')||'[]'),
   recentArtists:JSON.parse(localStorage.getItem('albumaday.recentRecommendedArtists.v1')||'[]'),
   pickDays:JSON.parse(localStorage.getItem('albumaday.pickDays')||'[]'),
   lastfmProfile:JSON.parse(localStorage.getItem('albumaday.lastfmTaste')||'null')
  };
 }catch{return {diary:[],deletedDiaryKeys:[],seenKeys:[],recentArtists:[],pickDays:[],lastfmProfile:null}}
}
function applyLocal(state){
 const api=pickerApi();
 if(api?.applyState){api.applyState(state);return}
 try{
  localStorage.setItem('albumaday.logs',JSON.stringify(state.diary||[]));
  localStorage.setItem('albumaday.diaryDeleted.v1',JSON.stringify(state.deletedDiaryKeys||[]));
  localStorage.setItem('albumaday.seenKeys.v1',JSON.stringify(state.seenKeys||[]));
  localStorage.setItem('albumaday.recentRecommendedArtists.v1',JSON.stringify(state.recentArtists||[]));
  localStorage.setItem('albumaday.pickDays',JSON.stringify(state.pickDays||[]));
  if(state.lastfmProfile)localStorage.setItem('albumaday.lastfmTaste',JSON.stringify(state.lastfmProfile));
  else localStorage.removeItem('albumaday.lastfmTaste');
 }catch{}
}
function rowToState(row){
 if(!row)return null;
 return {
  diary:Array.isArray(row.diary)?row.diary:[],
  deletedDiaryKeys:Array.isArray(row.deleted_diary_keys)?row.deleted_diary_keys:[],
  seenKeys:Array.isArray(row.seen_keys)?row.seen_keys:[],
  recentArtists:Array.isArray(row.recent_artists)?row.recent_artists:[],
  pickDays:Array.isArray(row.pick_days)?row.pick_days:[],
  lastfmProfile:row.lastfm_profile||null
 };
}
function stateToRow(state,userId){
 return {
  user_id:userId,
  diary:state.diary||[],
  deleted_diary_keys:state.deletedDiaryKeys||[],
  seen_keys:state.seenKeys||[],
  recent_artists:state.recentArtists||[],
  pick_days:state.pickDays||[],
  lastfm_profile:cloudLastfm(state.lastfmProfile),
  schema_version:1,
  updated_at:new Date().toISOString()
 };
}
function setSyncStatus(textValue,stateName=''){
 const node=$('accountSyncStatus');
 if(node){node.textContent=textValue;node.dataset.state=stateName}
}
function renderAuth(){
 const signedIn=Boolean(session?.user);
 const toggle=$('accountToggle');
 const guest=$('accountGuest');
 const member=$('accountMember');
 if(toggle){
  toggle.hidden=!CONFIG.enabled;
  toggle.classList.toggle('signed-in',signedIn);
  toggle.querySelector('[data-account-label]')?.replaceChildren(document.createTextNode(
   signedIn?'synced':'save history'
  ));
 }
 if(guest)guest.hidden=signedIn;
 if(member)member.hidden=!signedIn;
 if(signedIn){
  const email=$('accountEmail');
  if(email)email.textContent=session.user.email||'signed in';
  setSyncStatus(syncing?'syncing…':'synced','ok');
 }else setSyncStatus('guest mode · saved on this browser','guest');
}
async function syncNow(options={}){
 if(!client||!session?.user||syncing)return null;
 syncing=true;renderAuth();setSyncStatus('syncing…','busy');
 const userId=session.user.id;
 try{
  const local=readLocal();
  const {data,error}=await client
   .from(TABLE)
   .select('user_id,diary,deleted_diary_keys,seen_keys,recent_artists,pick_days,lastfm_profile,updated_at')
   .eq('user_id',userId)
   .maybeSingle();
  if(error)throw error;

  let merged;
  if(!data){
   merged=local;
  }else if(!hasMigrated()||dirty||options.forceMerge){
   merged=mergeState(rowToState(data),local);
  }else{
   merged=rowToState(data);
  }

  const {error:writeError}=await client.from(TABLE).upsert(stateToRow(merged,userId),{onConflict:'user_id'});
  if(writeError)throw writeError;

  applyLocal(merged);
  setMigrated();
  dirty=false;
  try{localStorage.setItem(LAST_SYNC_PREFIX+userId,new Date().toISOString())}catch{}
  setSyncStatus('synced across devices','ok');
  return merged;
 }catch(error){
  console.warn('Cloud sync failed',error);
  setSyncStatus('sync paused · local copy is safe','error');
  if(!options.silent)toast('Cloud sync paused. Your local diary is still safe.');
  return null;
 }finally{
  syncing=false;renderAuth();
 }
}
function scheduleSync(){
 dirty=true;
 if(!session?.user)return;
 clearTimeout(syncTimer);
 syncTimer=setTimeout(()=>syncNow({silent:true}),900);
}
function accountClientId(){
 return session?.user?.id?'account:'+session.user.id:null;
}
function openDialog(){
 const dialog=$('accountDialog');
 if(dialog&&!dialog.open)dialog.showModal();
}
function closeDialog(){
 const dialog=$('accountDialog');
 if(dialog?.open)dialog.close();
}
async function signInEmail(event){
 event?.preventDefault?.();
 const email=String($('accountEmailInput')?.value||'').trim();
 if(!email)return;
 const button=$('emailMagicLink');
 if(button)button.disabled=true;
 setSyncStatus('sending sign-in link…','busy');
 try{
  const redirectTo=CONFIG.redirectTo||location.origin+location.pathname;
  const {error}=await client.auth.signInWithOtp({
   email,
   options:{emailRedirectTo:redirectTo,shouldCreateUser:true}
  });
  if(error)throw error;
  const sent=$('accountEmailSent');
  if(sent){sent.hidden=false;sent.textContent='check your email · the sign-in link expires soon'}
  setSyncStatus('magic link sent','ok');
 }catch(error){
  console.warn('Magic-link sign in failed',error);
  setSyncStatus('could not send link','error');
 }finally{
  if(button)button.disabled=false;
 }
}
async function signInGoogle(){
 try{
  const redirectTo=CONFIG.redirectTo||location.origin+location.pathname;
  const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
  if(error)throw error;
 }catch(error){
  console.warn('Google sign in failed',error);
  setSyncStatus('google sign-in failed','error');
 }
}
async function signOut(){
 try{
  await client.auth.signOut();
  session=null;renderAuth();closeDialog();
  toast('Signed out. This browser keeps its local copy.');
 }catch(error){console.warn('Sign out failed',error)}
}
function bind(){
 $('accountToggle')?.addEventListener('click',openDialog);
 $('closeAccountDialog')?.addEventListener('click',closeDialog);
 $('accountDialog')?.addEventListener('click',event=>{
  if(event.target===$('accountDialog'))closeDialog();
 });
 $('accountEmailForm')?.addEventListener('submit',signInEmail);
 $('googleSignIn')?.addEventListener('click',signInGoogle);
 $('accountSyncNow')?.addEventListener('click',()=>syncNow({forceMerge:true}));
 $('accountSignOut')?.addEventListener('click',signOut);
 const google=$('googleSignIn');
 if(google)google.hidden=!CONFIG.googleEnabled;
}
async function init(){
 if(initialized)return;
 initialized=true;
 bind();
 if(!CONFIG.enabled||!CONFIG.url||!CONFIG.publishableKey||!window.supabase?.createClient){
  renderAuth();
  return;
 }
 try{
  client=window.supabase.createClient(CONFIG.url,CONFIG.publishableKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data?.session||null;
  renderAuth();
  if(session?.user)setTimeout(()=>syncNow({forceMerge:!hasMigrated(),silent:true}),0);

  client.auth.onAuthStateChange((event,nextSession)=>{
   session=nextSession||null;
   renderAuth();
   if(session?.user&&(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')){
    setTimeout(()=>syncNow({forceMerge:!hasMigrated(),silent:true}),0);
   }
  });
 }catch(error){
  console.warn('Account sync unavailable',error);
  setSyncStatus('account sync unavailable','error');
 }
}

window.AlbumAuth={
 scheduleSync,
 syncNow,
 clientId:accountClientId,
 isSignedIn:()=>Boolean(session?.user),
 open:openDialog
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
