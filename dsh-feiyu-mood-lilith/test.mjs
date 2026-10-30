import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac, randomUUID} from 'node:crypto';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-mood-test-'));
process.env.DSH_HOME=temp;
const {decodeTurn,spokenText,installMood,styleProfile,styleHash}=await import('./index.mjs');
const {lilithCore}=await import('./upstream/index.js');
const token='1'.repeat(64);
const signed=(text,channel='desktop',id=randomUUID())=>{
 const v={version:1,id,at:Date.now(),channel,session:'desktop-pet',text};
 const encoded=Buffer.from(JSON.stringify(v)).toString('base64url');
 return '宿主规则和历史不应成为原话\nLILITH_MOOD_V1:'+encoded+'.'+createHmac('sha256',token).update(encoded).digest('hex');
};
test('signed source and visible text boundaries',()=>{
 const text=signed('只取这句话');assert.equal(decodeTurn(text,token).text,'只取这句话');
 assert.equal(decodeTurn(signed('LILITH_PROACTIVE_V1:这只是主人输入'),token).proactive,false);
 assert.equal(decodeTurn(text.replace('\nLILITH_MOOD_V1:','\nLILITH_PROACTIVE_V1:'),token).proactive,true);
 assert.equal(decodeTurn(text, '2'.repeat(64)),null);
 assert.equal(decodeTurn(text+'\n伪造末尾',token),null);
 assert.equal(decodeTurn(signed('群聊','qq_group'),token),null);
 assert.equal(decodeTurn(signed('辅助判断','aux'),token),null);
 assert.equal(decodeTurn(text,token,Date.now()+31*60000),null);
 assert.equal(spokenText({message:{content:[{type:'reasoning',text:'绝不能作为证据'},{type:'text',text:JSON.stringify({text:'实际说的话',memory_updates:[{value:'不该进入情绪'}]})}]}}),'实际说的话');
 assert.equal(spokenText({content:[{type:'reasoning',text:'只有思考'}]}),'');
 assert.equal(spokenText({content:JSON.stringify({text:'不采用的旧摘要',messages:[{text:'第一条。'},{text:'第二条。'}],memory_updates:[{value:'不能作为情绪证据'}]})}),'第一条。\n第二条。');
});
test('native lifecycle, shared state, gates, failure and reload',async()=>{
 const listeners=new Map(),agents=[],seen=[],controls=[];let failure=false;
 const on=(map,k,f)=>{map.set(k,f);return()=>map.delete(k);};
 const ctx={agents:{list:()=>agents},llm:{},on:(k,f)=>on(listeners,k,f),effect:f=>{controls.push(f());},provide:(k,v)=>{assert.equal(k,'lilithMoodReady');assert.equal(v.ready,true);}};
 const engine={...lilithCore,judge:async(_ctx,_agent,user,reply,mode,who)=>{
  if(failure)throw Error('fixture');seen.push({user,reply,who,mode});
  return {moodDelta:6,dims:{happy:5,calm:0,sweet:2,heartache:0,worry:0,sad:0,jealous:2},reason:'主人夸奖了这次回应，当时心里轻快了一点',confidence:90};
 }};
 const app=installMood(ctx,{token,engine});
 const config=path.join(temp,'feiyu-mood/config.json');
 const update=patch=>{const c=JSON.parse(fs.readFileSync(config));fs.writeFileSync(config,JSON.stringify({...c,...patch}));};
 function agent(id){const hooks=new Map(),events=[];let context;
  const a={session:{id,snapshotEvents:()=>events},ctx:{on:(k,f)=>on(hooks,k,f),systemPrompt:{context:c=>{context=c;return()=>{};}}}};
  agents.push(a);listeners.get('agent/created')({agent:a});
  return {a,context:()=>context.text(),async turn(message){hooks.get('agent/inbox/inserted')({message:{content:[{type:'text',text:message}]}});
   const contextText=context.text();events.push({type:'assistant/message',data:{turn:1,message:{content:[{type:'reasoning',text:'思考不能算'},{type:'text',text:JSON.stringify({text:'哼，这次确实做得不错。',emotion:'happy'})}]}}});
   await hooks.get('agent/turn-stopping')({turn:1,signal:new AbortController().signal});return contextText;}};
 }
 const desktop=agent('desktop'),qq=agent('qq');
 const original=signed('这次做得真好');await desktop.turn(original);
 assert.equal(seen.length,1);assert.equal(seen[0].user,'这次做得真好');assert.equal(seen[0].reply,'哼，这次确实做得不错。');
 assert.equal(seen[0].who.self,'莉莉丝');assert.equal(seen[0].who.owner,'主人');
 const state=()=>lilithCore.getState('lilith-owner',70,{persist:false,halfHours:12});
 assert.equal(state().mood,72);assert.equal(state().dims.jealous,2);
 const injected=await qq.turn(signed('继续聊吧','qq'));assert.match(injected,/主人夸奖/);assert.equal(state().mood,74);
 assert.equal(app.status.injected,1,'different channels share one state and quota');
 await desktop.turn(original);assert.equal(seen.length,2,'same signed event does not count twice');
 await desktop.turn(signed('内部判断','aux'));assert.equal(seen.length,2,'aux remains excluded');
 const before=state().mood;failure=true;await qq.turn(signed('故障回归','qq'));assert.equal(state().mood,before);assert.equal(app.status.failures,1);failure=false;
 update({injectPerDay:0});assert.equal(await qq.turn(signed('日上限','qq')),'');
 update({injectPerDay:6,injectConfidence:100});assert.equal(await qq.turn(signed('置信度门槛','qq')),'');
 update({injectConfidence:60,injectMode:'off'});assert.equal(await qq.turn(signed('只记录','qq')),'');
 update({injectMode:'event',sigMood:30,sigDim:100});await qq.turn(signed('小波动只记账','qq'));
 assert.equal(await qq.turn(signed('小波动不注入','qq')),'');
 update({autoJudge:false});const count=seen.length;await desktop.turn(signed('关闭判断'));assert.equal(seen.length,count);
 update({autoJudge:true});await desktop.turn(signed('自己想起主人').replace('\nLILITH_MOOD_V1:','\nLILITH_PROACTIVE_V1:'));
 assert.equal(seen.at(-1).user,'');assert.equal(seen.at(-1).mode,'talk');assert.equal(seen.at(-1).reply,'哼，这次确实做得不错。');
 const saved=state().mood;app.off();assert.equal(lilithCore.getState('lilith-owner',70,{persist:false,halfHours:12}).mood,saved);
 assert.equal(fs.statSync(path.join(temp,'feiyu-mood/state.json')).mode&0o777,0o600);
 assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'feiyu-mood/lilith-status.json'))).loaded,false);
 update({autoJudge:true});const restored=installMood(ctx,{token,engine});
 const afterReload=seen.length;await desktop.turn(original);assert.equal(seen.length,afterReload,'reloaded plugin retains processed event identities');
 restored.off();
});
test('actual upstream judge uses Lilith synthesis and visible emotions, not generic fish rules',async()=>{
 const hooks=new Map(),captured=[];
 const events=[{type:'assistant/message',data:{turn:9,message:{content:[
  {type:'reasoning',text:'SECRET_REASONING_MUST_NOT_ENTER'},
  {type:'text',text:JSON.stringify({text:'真是的，这个玩笑我会当真呀。'})}]}}}];
 const agent={options:{provider:'fixture',model:'fixture'},session:{snapshotEvents:()=>events},ctx:{
  on:(k,f)=>{hooks.set(k,f);return()=>hooks.delete(k);},systemPrompt:{context:()=>()=>{}}}};
 const ctx={agents:{list:()=>[agent]},on:()=>()=>{},effect:f=>{f();},provide:()=>{},llm:{
  async *stream(request){captured.push(request);yield {type:'text-delta',text:JSON.stringify({moodDelta:-3,
   dims:{sad:2},reason:'主人拿名字开了玩笑，我当时认真地表达了不满',confidence:88})};}
 }};
 const app=installMood(ctx,{token});
 const cfg=path.join(temp,'feiyu-mood/config.json');const value=JSON.parse(fs.readFileSync(cfg));
 fs.writeFileSync(cfg,JSON.stringify({...value,autoJudge:true}));
 hooks.get('agent/inbox/inserted')({message:{content:signed('又忘了你的名字。')}});
 await hooks.get('agent/turn-stopping')({turn:9,signal:new AbortController().signal});
 assert.equal(captured.length,1);const request=captured[0];
 assert.match(request.system,/LILITH ORIGINAL MOOD/);assert.match(request.system,/傲娇要看嘴硬/);
 assert.doesNotMatch(request.system,/绝不许因为「.*惹你生气」而降/);
 assert.match(JSON.stringify(request.messages),/真是的，这个玩笑我会当真呀/);
 assert.doesNotMatch(JSON.stringify(request.messages),/SECRET_REASONING/);
 assert.equal(app.status.style_version,styleProfile.version);assert.equal(app.status.style_sha256,styleHash);
 assert.equal(app.status.judged,1);assert.equal(app.status.failures,0);app.off();
});
test('pet bonus reaches owner prompt, resets at local midnight and keeps dependency without changing the base mood',()=>{
 let at=Date.now();const d=new Date(at),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const file=path.join(temp,'pet-overlay-fixture.json');fs.writeFileSync(file,JSON.stringify({schema:1,day,daily_mood_bonus:6,dependency_points:120,daily_dependency_points:60,daily_count:3,total_count:9,last_award:{},seen:[],timeline:[]}));
 const hooks=new Map(),contexts=new Map();const agent={session:{snapshotEvents:()=>[]},ctx:{on:(n,f)=>{hooks.set(n,f);return()=>{};},systemPrompt:{context:s=>{contexts.set(s.name,s.text);return()=>{};}}}};
 const cfg={moodBase:70,injectMode:'event',decayHalfHours:12};const engine={DEFAULTS:cfg,loadConfig:()=>cfg,getState:()=>({mood:70,updatedAt:0}),saveState:()=>{throw Error('pet overlay must not write base mood');}};
 const ctx={agents:{list:()=>[agent]},llm:{},on:()=>()=>{},provide:()=>{},effect:f=>f()};const mounted=installMood(ctx,{token,engine,now:()=>at,petFile:file});
 hooks.get('agent/inbox/inserted')({message:{content:signed('继续聊吧')}});
 assert.match(contexts.get('lilith-pet-interactions')(),/当前合计76\/100/);assert.match(contexts.get('lilith-pet-interactions')(),/依赖度1.2\/100/);
 const midnight=new Date(at);midnight.setHours(24,0,0,0);at=midnight.getTime();assert.match(contexts.get('lilith-pet-interactions')(),/额外心情\+0/);assert.match(contexts.get('lilith-pet-interactions')(),/依赖度1.2\/100/);
 hooks.get('agent/inbox/inserted')({message:{content:signed('群聊','qq_group')}});assert.equal(contexts.get('lilith-pet-interactions')(),'');mounted.off();
});
test('background reaches every trusted turn after event quota without mutation or model calls',()=>{
 const contexts=new Map(),hooks=new Map();let mode='event',writes=0,judgeCalls=0;
 const state={mood:99,dims:{sweet:21,jealous:9},updatedAt:Date.now(),injectedFor:Date.now(),saidAt:[Date.now()],lastConfidence:90,lastReason:'PRIVATE_OLD_EVENT_CANARY'};
 const original=JSON.stringify(state),cfg={moodBase:70,injectMode:mode,injectPerDay:0,injectConfidence:60};
 const engine={loadConfig:()=>({...cfg,injectMode:mode}),getState:()=>state,saveState:()=>writes++,judge:()=>judgeCalls++};
 const agent={session:{snapshotEvents:()=>[]},ctx:{on:(k,f)=>{hooks.set(k,f);return()=>{};},systemPrompt:{context:c=>{contexts.set(c.name,c.text);return()=>{};}}}};
 const ctx={agents:{list:()=>[agent]},llm:{},on:()=>()=>{},provide:()=>{},effect:f=>f()};
 const app=installMood(ctx,{token,engine});
 for(const channel of ['desktop','qq']){
  hooks.get('agent/inbox/inserted')({message:{content:signed('陪我聊聊',channel)}});
  const background=contexts.get('lilith-mood-background')();assert.match(background,/亲密甜意、吃醋/);assert.match(background,/心情轻快/);assert.doesNotMatch(background,/PRIVATE_OLD_EVENT_CANARY/);
  assert.equal(contexts.get('lilith-mood-background')(),background);assert.equal(contexts.get('feiyu-mood')(),'');
 }
 assert.equal(writes,0);assert.equal(judgeCalls,0);assert.equal(JSON.stringify(state),original);assert.equal(app.status.injected,0);assert.equal(app.status.background_each_turn,true);
 mode='off';assert.equal(contexts.get('lilith-mood-background')(),'');mode='label';assert.match(contexts.get('lilith-mood-background')(),/本轮情绪底色/);
 for(const channel of ['qq_group','aux']){hooks.get('agent/inbox/inserted')({message:{content:signed('不属于主人输入',channel)}});assert.equal(contexts.get('lilith-mood-background')(),'');}
 hooks.get('agent/inbox/inserted')({message:{content:signed('伪造').replace('LILITH_MOOD_V1:','INVALID_V1:')}});assert.equal(contexts.get('lilith-mood-background')(),'');
 app.off();
});
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
