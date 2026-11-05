(()=>{
'use strict';

const CONFIG=window.ALBUM_AUTH_CONFIG||{};
const TABLE='user_sync_state';
const SUPPORTER_TABLE='supporter_entitlements';
const SUPPORTER_CHECKOUT='https://buy.stripe.com/cNi14n8KIdC36CJ9fY93y00';
const SUPPORTER_PORTAL='https://billing.stripe.com/p/login/cNi14n8KIdC36CJ9fY93y00';
const SUPPORTER_ACTIVE=new Set(['active','trialing']);
const MIGRATION_PREFIX='albumaday.cloudMigrated.v1:';
const LAST_SYNC_PREFIX='albumaday.cloudLastSync.v1:';
const $=id=>document.getElementById(id);

let client=null;
let session=null;
let syncing=false;
let syncTimer=null;
let dirty=false;
let initialized=false;
let supporter=null;
let supporterLoaded=false;

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
function isSupporter(){return SUPPORTER_ACTIVE.has(String(supporter?.status||''))}
function notifySupporter(){
 window.dispatchEvent(new CustomEvent('albumaday:supporterchange',{detail:{
  active:isSupporter(),
  status:String(supporter?.status||'free')
 }}));
}
function supporterCheckoutUrl(){
 if(!session?.user?.id||!session?.user?.email)return '';
 const url=new URL(SUPPORTER_CHECKOUT);
 url.searchParams.set('client_reference_id',session.user.id);
 url.searchParams.set('locked_prefilled_email',session.user.email);
 return url.toString();
}
function supporterPortalUrl(){
 if(!session?.user?.email)return '';
 const url=new URL(SUPPORTER_PORTAL);
 url.searchParams.set('prefilled_email',session.user.email);
 return url.toString();
}
function renderSupporter(){
 const panel=$('supporterPanel');
 const status=$('supporterStatus');
 const copy=$('supporterCopy');
 const badge=$('supporterBadge');
 const subscribe=$('supporterSubscribe');
 const manage=$('supporterManage');
 const refresh=$('supporterRefresh');
 const syncButton=$('accountSyncNow');
 const active=isSupporter();
 if(panel){
  panel.classList.toggle('is-active',active);
  panel.classList.toggle('is-past-due',supporter?.status==='past_due');
 }
 if(status){
  if(!supporterLoaded)status.textContent='checking status…';
  else if(active)status.textContent='supporter active';
  else if(supporter?.status==='past_due')status.textContent='payment needs attention';
  else status.textContent='free account';
 }
 if(copy){
  copy.textContent=active
   ? 'cross-device diary, no-repeat history, streak and taste sync are unlocked.'
   : supporter?.status==='past_due'
     ? 'your supporter payment needs attention. local listening data is still safe on this browser.'
     : 'the picker and local diary stay free. supporter unlocks cross-device history + taste sync and helps keep this project running.';
 }
 if(badge){badge.hidden=!active;badge.textContent='$3 / month'}
 if(subscribe){
  const checkout=supporterCheckoutUrl();
  subscribe.hidden=active||!checkout;
  subscribe.href=checkout||'#';
 }
 if(manage){
  const portal=supporterPortalUrl();
  manage.hidden=!supporter||!portal;
  manage.href=portal||'#';
 }
 if(refresh)refresh.hidden=!session?.user;
 if(syncButton){
  syncButton.disabled=!active;
  syncButton.title=active?'Sync your account now':'Supporter unlocks cross-device sync';
 }
}
async function refreshSupporterStatus(options={}){
 if(!client||!session?.user){
  supporter=null;supporterLoaded=false;renderSupporter();notifySupporter();return null;
 }
 try{
  const {data,error}=await client
   .from(SUPPORTER_TABLE)
   .select('status,current_period_end,cancel_at_period_end,updated_at')
   .eq('user_id',session.user.id)
   .maybeSingle();
  if(error)throw error;
  supporter=data||null;
  supporterLoaded=true;
  renderSupporter();
  renderAuth();
  notifySupporter();
  return supporter;
 }catch(error){
  console.warn('Supporter status check failed',error);
  supporter=null;supporterLoaded=true;renderSupporter();renderAuth();notifySupporter();
  if(!options.silent)toast('Could not refresh Supporter status.');
  return null;
 }
}
function cleanSupporterReturnParam(){
 const url=new URL(location.href);
 if(url.searchParams.get('supporter')!=='thanks')return;
 url.searchParams.delete('supporter');
 history.replaceState(null,'',url.pathname+url.search+url.hash);
}
async function reconcileSupporterReturn(){
 const returning=new URL(location.href).searchParams.get('supporter')==='thanks';
 if(!returning||!session?.user)return;
 toast('Payment received — confirming Supporter status…');
 for(const delay of [0,900,2200]){
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  await refreshSupporterStatus({silent:true});
  if(isSupporter()){
   toast('Supporter active. Cloud sync is unlocked.');
   cleanSupporterReturnParam();
   await syncNow({forceMerge:true,silent:true});
   return;
  }
 }
 toast('Stripe received the payment. Status can take a moment to appear.');
 cleanSupporterReturnParam();
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
   signedIn?'account':'log in'
  ));
 }
 if(guest)guest.hidden=signedIn;
 if(member)member.hidden=!signedIn;
 const drawerCta=$('openAccountFromDrawer');
 if(drawerCta)drawerCta.hidden=!CONFIG.enabled||signedIn;
 if(signedIn){
  const email=$('accountEmail');
  if(email)email.textContent=session.user.email||'signed in';
  if(syncing)setSyncStatus('syncing…','busy');
  else if(!supporterLoaded)setSyncStatus('checking supporter status…','busy');
  else if(isSupporter())setSyncStatus('supporter · synced across devices','ok');
  else if(supporter?.status==='past_due')setSyncStatus('supporter payment needs attention · local copy safe','error');
  else setSyncStatus('free account · listening data stays on this browser','guest');
 }else setSyncStatus('guest mode · saved on this browser','guest');
 renderSupporter();
}
async function syncNow(options={}){
 if(!client||!session?.user||syncing)return null;
 if(!supporterLoaded)await refreshSupporterStatus({silent:true});
 if(!isSupporter()){
  renderAuth();
  if(!options.silent)toast('Supporter unlocks cross-device sync. Your local diary is safe.');
  return null;
 }
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
 if(!session?.user||!isSupporter())return;
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
  session=null;supporter=null;supporterLoaded=false;renderAuth();notifySupporter();closeDialog();
  toast('Signed out. This browser keeps its local copy.');
 }catch(error){console.warn('Sign out failed',error)}
}
function bind(){
 $('accountToggle')?.addEventListener('click',openDialog);
 $('openAccountFromDrawer')?.addEventListener('click',openDialog);
 $('closeAccountDialog')?.addEventListener('click',closeDialog);
 $('accountDialog')?.addEventListener('click',event=>{
  if(event.target===$('accountDialog'))closeDialog();
 });
 $('accountEmailForm')?.addEventListener('submit',signInEmail);
 $('googleSignIn')?.addEventListener('click',signInGoogle);
 $('accountSyncNow')?.addEventListener('click',()=>syncNow({forceMerge:true}));
 $('accountSignOut')?.addEventListener('click',signOut);
 $('supporterRefresh')?.addEventListener('click',async()=>{
  await refreshSupporterStatus();
  if(isSupporter())await syncNow({forceMerge:true,silent:true});
 });
 $('supporterFooter')?.addEventListener('click',openDialog);
 const google=$('googleSignIn');
 if(google)google.hidden=!CONFIG.googleEnabled;
 const emailForm=$('accountEmailForm');
 if(emailForm)emailForm.hidden=!CONFIG.emailEnabled;
 const emailOr=document.querySelector('.account-or');
 if(emailOr)emailOr.hidden=!CONFIG.emailEnabled;
}
async function init(){
 if(initialized)return;
 initialized=true;
 bind();
 if(!CONFIG.enabled||!CONFIG.url||!CONFIG.publishableKey||!window.supabase?.createClient){
  renderAuth();
  return;
 }
 const emailForm=$('accountEmailForm');
 if(emailForm)emailForm.hidden=!CONFIG.emailEnabled;
 const emailOr=document.querySelector('.account-or');
 if(emailOr)emailOr.hidden=!CONFIG.emailEnabled;
 try{
  client=window.supabase.createClient(CONFIG.url,CONFIG.publishableKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data?.session||null;
  renderAuth();
  if(session?.user)setTimeout(async()=>{
   await refreshSupporterStatus({silent:true});
   if(isSupporter())await syncNow({forceMerge:!hasMigrated(),silent:true});
   await reconcileSupporterReturn();
  },0);

  client.auth.onAuthStateChange((event,nextSession)=>{
   const previousUser=session?.user?.id||null;
   session=nextSession||null;
   if(previousUser!==session?.user?.id){
    supporter=null;supporterLoaded=false;
   }
   renderAuth();
   if(session?.user&&(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')){
    setTimeout(async()=>{
     await refreshSupporterStatus({silent:true});
     if(isSupporter())await syncNow({forceMerge:!hasMigrated(),silent:true});
     await reconcileSupporterReturn();
    },0);
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
 isSupporter,
 user:()=>session?.user||null,
 supporterStatus:()=>supporter?{...supporter}:null,
 refreshSupporterStatus,
 open:openDialog
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
