(()=>{
'use strict';

const EVENTS=new Set([
 'page_view','return_visit','pick_requested','pick_shown','spotify_clicked',
 'diary_saved','listening_completed','rating_submitted','diary_opened',
 'account_opened','sign_in_started','sign_in_completed',
 'supporter_teaser_opened','supporter_checkout_opened','supporter_active',
 'wrapped_opened'
]);
const VISITOR_KEY='albumaday.analyticsVisitor.v1';
const LAST_VISIT_KEY='albumaday.analyticsLastVisit.v1';
const SESSION_KEY='albumaday.analyticsSession.v1';

function safeStorage(storage,key){
 try{return storage.getItem(key)||''}catch{return ''}
}
function setStorage(storage,key,value){
 try{storage.setItem(key,value)}catch{}
}
function id(storage,key){
 let value=safeStorage(storage,key);
 if(!/^[0-9a-f-]{36}$/i.test(value)){
  value=crypto.randomUUID();
  setStorage(storage,key,value);
 }
 return value;
}
function day(){
 const d=new Date(),pad=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function sanitizeValue(value){
 if(typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return Math.max(-1000000,Math.min(1000000,value));
 if(typeof value==='string')return value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,80);
 return null;
}
function sanitizeProps(input){
 const out={};
 for(const [key,value] of Object.entries(input||{}).slice(0,16)){
  if(!/^[a-z0-9_]{1,40}$/i.test(key))continue;
  const clean=sanitizeValue(value);
  if(clean!==null)out[key]=clean;
 }
 out.device=matchMedia('(max-width:700px)').matches?'mobile':matchMedia('(max-width:1100px)').matches?'tablet':'desktop';
 return out;
}
function endpoint(){
 const config=window.ALBUM_AUTH_CONFIG||{};
 if(!config.url||!config.publishableKey)return null;
 return {
  url:config.url.replace(/\/$/,'')+'/rest/v1/product_events',
  key:config.publishableKey
 };
}
function track(event,properties={}){
 if(!EVENTS.has(String(event)))return Promise.resolve(false);
 const target=endpoint();if(!target)return Promise.resolve(false);
 const payload={
  event_name:String(event),
  visitor_id:id(localStorage,VISITOR_KEY),
  session_id:id(sessionStorage,SESSION_KEY),
  page_path:location.pathname.slice(0,160),
  properties:sanitizeProps(properties)
 };
 return fetch(target.url,{
  method:'POST',
  keepalive:true,
  headers:{
   'apikey':target.key,
   'Authorization':'Bearer '+target.key,
   'Content-Type':'application/json',
   'Prefer':'return=minimal'
  },
  body:JSON.stringify(payload)
 }).then(response=>response.ok).catch(()=>false);
}
function boot(){
 const today=day();
 const previous=safeStorage(localStorage,LAST_VISIT_KEY);
 track('page_view',{returning:Boolean(previous)});
 if(previous&&previous!==today){
  const delta=Math.max(1,Math.round((new Date(today+'T12:00:00')-new Date(previous+'T12:00:00'))/86400000));
  track('return_visit',{days_since:delta});
 }
 setStorage(localStorage,LAST_VISIT_KEY,today);
}
window.AlbumAnalytics={track};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();