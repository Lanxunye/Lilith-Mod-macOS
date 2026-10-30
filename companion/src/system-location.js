'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
const HELPER=path.resolve(__dirname,'../../../../LilithMod/helpers/LilithLocation.app');
const STATES=new Set(['available','services_disabled','permission_required','permission_denied','timeout','unavailable','no_fresh_fix']);
const clean=(s,n)=>String(s||'').replace(/[\x00-\x1f]/g,' ').slice(0,n);
function normalizeLocation(raw,now=Date.now()){
 if(!raw||!STATES.has(raw.status))return {status:'unavailable'};
 if(raw.status!=='available')return {status:raw.status};
 const {latitude,longitude,observed_at,accuracy_m}=raw;
 if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(observed_at)||observed_at>now+60000||now-observed_at>600000||!Number.isFinite(accuracy_m)||accuracy_m<0||accuracy_m>50000)return {status:'no_fresh_fix'};
 return {status:'available',latitude:Math.round(latitude*10)/10,longitude:Math.round(longitude*10)/10,accuracy_m:Math.max(10000,accuracy_m),observed_at,precision:'rounded_0.1_degree',city:clean(raw.city,80),country_code:/^[A-Z]{2}$/.test(raw.country_code||'')?raw.country_code:''};
}
async function systemLocation({root,helper=HELPER,requestPermission=false,run=execute,now=Date.now}={}){
 if(process.platform!=='darwin')return {status:'unsupported'};
 if(!fs.existsSync(path.join(helper,'Contents/MacOS/LilithLocation')))return {status:'helper_missing'};
 const id=crypto.randomUUID(),folder=path.join(root,'location/requests'),file=path.join(folder,id+'.json');fs.mkdirSync(folder,{recursive:true,mode:0o700});
 try{
  await run('/usr/bin/open',['-n','-W',helper,'--args','--request-id',id,'--data-root',root,...(requestPermission?['--request-permission']:[])],{timeout:70000,maxBuffer:8192});
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.request_id!==id)return {status:'unavailable'};return normalizeLocation(raw,now());
 }catch{return {status:'unavailable'};}
 finally{try{fs.unlinkSync(file);}catch{}}
}
module.exports={systemLocation,normalizeLocation,HELPER};
