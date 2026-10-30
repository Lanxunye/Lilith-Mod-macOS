'use strict';
// Desktop read-aloud only. Never changes conversation records or delivers QQ audio.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {speechPlan,speechForMessage}=require('./speech-prosody');
const ADAPTER='88ed7342a214af49e52bc21b10c06aa1a48bc44af37f09aea7733362efe1b09b';
function fault(code){return Object.assign(new Error(code),{code});}
function spokenText(text){
 if(typeof text!=='string'||text.length>8000)throw fault('invalid_speech_text');
 return text.replace(/[（(]([^()（）]{1,120})[）)]/g,(all,inner)=>/轻声|轻柔|低声|小声|温柔|微笑|轻笑|低头|抬头|眨眼|点头|摇头|叹气|抱紧|抱住|靠近/.test(inner)?'':all).replace(/```[\s\S]*?```/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'')
  .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'')
  .replace(/<[^>]*>/g,'').replace(/^[\s#>*-]+/gm,'').replace(/[*_`]/g,'').trim();
}
function chunks(text){const parts=[];let line='';for(const c of text){line+=c;if(line.length>=180||(/[。！？!?\n]/.test(c)&&line.length>=15)){parts.push(line.trim());line='';}}if(line.trim())parts.push(line.trim());return parts;}
function createChatSpeech({root,store,...options}){
 const settings=path.join(root,'speech-settings.json'),stateFile=path.join(root,'speech-state.json');
 const cache=path.join(root,'speech-cache');fs.mkdirSync(cache,{recursive:true,mode:0o700});
 const write=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 let enabled=false;try{enabled=JSON.parse(fs.readFileSync(settings)).enabled===true;}catch{}
 let closed=false,epoch=0,working=false,queue=[],active=null,player=null,backend=null,status='idle',error='',lastCompleted='',starting=null;
 const textStates=new Map(),textWaiters=new Map();
 // Only new, queued desktop speech holds its text. Archived messages are never held.
 function releaseText(id){
  if(textStates.get(id)!=='pending')return;textStates.set(id,'ready');
  for(const resolve of textWaiters.get(id)||[])resolve();textWaiters.delete(id);
  queueMicrotask(()=>{if(!closed)options.onTextReady?.();});
 }
 function releasePendingText(){for(const [id,state]of textStates)if(state==='pending')releaseText(id);}
 function trimTextStates(){if(textStates.size>256)for(const [id,state]of textStates){if(state==='ready')textStates.delete(id);if(textStates.size<=256)break;}}
 const latest=()=>Number(store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM messages WHERE session='desktop-pet'").get().n);
 let cursor=latest();
 const snapshot=()=>({enabled,status,error,queued:queue.length,adapter_sha256:ADAPTER,last_completed:lastCompleted,text_follow:'after_voice_start'});
 const publish=()=>{if(!closed)write(stateFile,snapshot());};
 const request=options.request||fetch;
 const stop=()=>{epoch++;queue=[];active?.abort();try{player?.kill('SIGTERM');}catch{}releasePendingText();status='idle';error='';cursor=latest();publish();};
 async function ensureBackend(signal){
  const health=async()=>{const r=await request('http://127.0.0.1:8875/local/lilith/health',{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});
   if(!r.ok)throw fault('speech_backend_unavailable');const j=await r.json();if(j.adapter_sha256!==ADAPTER)throw fault('speech_adapter_mismatch');return j;};
  try{return await health();}catch(e){if(signal.aborted)throw e;if(e.code==='speech_adapter_mismatch')throw e;}
  if(!starting)starting=(async()=>{
   const appRoot=path.join(os.homedir(),'Applications/Qwen3-TTS-MLX');
   const script=path.join(appRoot,'local-deployment/server.py'),python=path.join(appRoot,'.venv/bin/python');
   if(!fs.existsSync(script)||!fs.existsSync(python))throw fault('speech_backend_not_installed');
   backend=spawn(python,[script],{cwd:appRoot,env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'},stdio:'ignore'});
   backend.on('error',()=>{});backend.unref();
   try{for(let i=0;i<60;i++){if(signal.aborted)throw fault('speech_cancelled');await new Promise(r=>setTimeout(r,250));try{return await health();}catch(e){if(e.code==='speech_adapter_mismatch')throw e;}}throw fault('speech_backend_unavailable');}
   finally{starting=null;}
  })();
  return starting;
 }
 async function synthesize(text,signal=new AbortController().signal,context={}){
  const clean=spokenText(text);if(!clean||clean.length>500)throw fault('invalid_speech_text');
  await ensureBackend(signal);
    const response=await request('http://127.0.0.1:8875/local/lilith/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean,...speechPlan(clean,context)}),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
    if(!response.ok||!/^audio\/wav/i.test(response.headers.get('content-type')||''))throw fault('speech_synthesis_failed');
    const size=Number(response.headers.get('content-length')||0);if(size>16*1024*1024)throw fault('speech_audio_too_large');
    const pieces=[];let total=0;for await(const data of response.body){total+=data.length;if(total>16*1024*1024)throw fault('speech_audio_too_large');pieces.push(data);}
    const bytes=Buffer.concat(pieces);if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fault('speech_invalid_audio');
    return {bytes,type:"audio/wav"};
 }
 function play(file,signal,onStarted){return new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(fault('speech_cancelled'));
  const child=(options.spawnPlayer||spawn)('/usr/bin/afplay',[file],{stdio:'ignore'});player=child;
  const abort=()=>{try{child.kill('SIGTERM');}catch{}};signal.addEventListener('abort',abort,{once:true});
  let lead=null;
  // afplay exposes process startup rather than an audio-device clock. Give it a
  // short head start before letting the game's existing typewriter begin.
  child.once('spawn',()=>{lead=setTimeout(()=>{if(!signal.aborted)onStarted();},options.textLeadMs??150);});
  const done=(err)=>{clearTimeout(lead);signal.removeEventListener('abort',abort);if(player===child)player=null;err?reject(err):resolve();};
  child.once('error',()=>done(fault('speech_playback_failed')));child.once('exit',(code)=>done(signal.aborted?fault('speech_cancelled'):code===0?null:fault('speech_playback_failed')));
 });}
 async function drain(){
  if(working||closed)return;working=true;
  try{while(enabled&&queue.length&&!closed){const item=queue.shift(),mine=epoch;active=new AbortController();const signal=active.signal;
   try{
    status='preparing';error='';publish();
    const {bytes}=await synthesize(item.text,signal,{speech:item.speech});
    if(!enabled||mine!==epoch||signal.aborted)continue;
    const file=path.join(cache,crypto.randomUUID()+'.wav');fs.writeFileSync(file,bytes,{mode:0o600});
    try{status='playing';publish();await play(file,signal,()=>{if(mine===epoch)releaseText(item.textId);});if(mine===epoch){lastCompleted=item.id;releaseText(item.textId);}}
    finally{fs.rmSync(file,{force:true});}
   }catch(e){if(mine===epoch&&!signal.aborted){status='unavailable';error=e.code&&/^speech_/.test(e.code)?e.code:'speech_unavailable';queue=[];releasePendingText();publish();}}
   finally{if(mine===epoch)active=null;}
  }}finally{working=false;if(!error){status='idle';publish();}if(queue.length&&enabled&&!closed)void drain();}
 }
 const enqueue=(id,text,context={})=>{if(!enabled||closed)return false;const clean=spokenText(text);if(!clean)return false;const items=chunks(clean);
  if(queue.length+items.length>16){error='speech_queue_full';publish();return false;}
  textStates.set(id,'pending');trimTextStates();
  queue.push(...items.map((text,index)=>({id:id+':'+index,textId:id,text,speech:speechPlan(text,context)})));publish();void drain();return true;};
 const poll=()=>{if(closed)return;let rows;do{rows=store.messages('desktop-pet',cursor,100);for(const r of rows){cursor=Math.max(cursor,r.seq);
   if(!enabled||r.role!=='assistant'||!['desktop','proactive'].includes(r.channel)||r.request_id==='legacy'||r.request_id.startsWith('seed:')||r.reply_part?.state==='cancelled')continue;
   enqueue(r.id,r.content,{speech:speechForMessage(store,r)});
  }}while(rows.length===100);};
 const timer=options.autoTick===false?null:setInterval(()=>{try{poll();}catch{}},250);timer?.unref();publish();
 return {status:snapshot,poll,enqueue,stop,synthesize,
  async waitForText(id){poll();if(textStates.get(id)!=='pending')return;await new Promise(resolve=>{const waiters=textWaiters.get(id)||[];waiters.push(resolve);textWaiters.set(id,waiters);});},
  visibleMessages(rows){poll();const blocked=rows.findIndex(row=>textStates.get(row.id)==='pending');return blocked<0?rows:rows.slice(0,blocked);},
  async health(){try{const r=await request('http://127.0.0.1:8875/local/lilith/health',{signal:AbortSignal.timeout(2000)});const j=await r.json();return {online:r.ok&&j.adapter_sha256===ADAPTER,loaded:j.loaded===true};}catch{return {online:false,loaded:false};}},
  patch(body){if(!body||Object.keys(body).length!==1||typeof body.enabled!=='boolean')throw fault('invalid_speech_settings');stop();enabled=body.enabled;write(settings,{enabled});publish();return snapshot();},
  close(){stop();closed=true;clearInterval(timer);try{backend?.kill('SIGTERM');}catch{}}};
}
module.exports={createChatSpeech,spokenText,chunks,ADAPTER};
