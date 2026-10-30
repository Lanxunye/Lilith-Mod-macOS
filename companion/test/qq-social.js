'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store');
const {createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-social-')),store=new ConversationStore(root);
 let clock=new Date('2026-10-24T04:00:00Z'),id=0,policy=()=>({action:'reply',topic:'茶'}),decisions=[],chats=[],sends=[],onChat;
 const bridge=createQQBridge({root,store,autoTick:false,now:()=>clock,random:()=>0,getPlayerName:()=> 'owner',
  decide:async input=>{decisions.push(input);return policy(input);},
  request:async(url,options)=>({ok:true,json:async()=>url.endsWith('/get_login_info')?{status:'ok',retcode:0,data:{user_id:222222}}:(sends.push(JSON.parse(options.body)),{status:'ok',retcode:0,data:{message_id:sends.length}})}),
  chat:async(session,body,channel)=>{chats.push(body);if(onChat)onChat();const out=bridge.mirror(channel,body.message,{text:'茶确实不错。'},session);if(out)store.enqueue(session,body.request_id,out.target,out.text);}
 });
 const event=(text,{user=333333,force=false,group=444444}={})=>{const raw=JSON.stringify({post_type:'message',message_type:'group',self_id:222222,user_id:user,group_id:group,message_id:++id,sender:{card:'成员'+user},message:[...(force?[{type:'at',data:{qq:222222}}]:[]),{type:'text',data:{text}}]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));};
 const advance=ms=>{clock=new Date(clock.getTime()+ms);};
 const tick=async(ms=10000)=>{advance(ms);await bridge.tick();};
 const pending=()=>store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state='pending'").get().n;
 try{
  bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',group_enabled:true,group_ids:['444444','555555'],quiet_ms:2000,min_interval_ms:1000});
  event('我在想');await bridge.tick();assert.equal(decisions.length,0,'wait for a short-message burst');event('喝茶');await tick();
  assert.equal(chats.length,1);assert.equal(sends.length,1);assert.equal(decisions[0].current.text,'我在想\n喝茶');assert.equal(pending(),0);
  policy=()=>({action:'skip'});event('这是别人的话题');await tick();assert.equal(sends.length,1);assert.equal(bridge.status().group_daily_used,1);assert.equal(bridge.status().social_state[0].active,0);
  event('莉莉丝？',{force:true});await tick(1);assert.equal(sends.length,2,'@ overrides a skip decision');
  let waits=0;policy=()=>({action:++waits===1?'wait':'reply'});event('还有');await tick();assert.equal(pending(),1);await tick(1000);assert.equal(waits,1);event('一件事');await tick();assert.equal(waits,2);assert.match(chats.at(-1).message,/还有\\n一件事/);
  policy=()=>({action:'wait'});event('说到一半');await tick();await tick();assert.equal(pending(),0,'wait is bounded and cannot loop indefinitely');
  policy=()=>({action:'reply'});event('A1');event('B1',{user:555555});event('A2');await tick();assert.equal(decisions.at(-1).current.text,'A1','never merge across another speaker');await tick();assert.equal(decisions.at(-1).current.speaker.qq,'555555');await tick();assert.equal(decisions.at(-1).current.text,'A2');
  onChat=()=>{onChat=null;event('换个话题',{user:555555});};event('旧话题');const before=sends.length;await tick();assert.equal(sends.length,before,'cancel stale non-@ output if a new message arrives during generation');assert.ok(store.outbox().some(r=>r.error==='qq_topic_superseded'));await tick();
  const decisionCount=decisions.length;event('频率一');await tick();event('频率二');await tick(1);assert.equal(decisions.length,decisionCount+1,'ordinary decision calls have a cooldown');await tick();
  await tick(601000);assert.equal(bridge.status().social_state[0].active,0,'topics expire without an artificial ten-reply cap');
  bridge.configure({random_wake_enabled:true,random_wake_probability:.2,idle_topic_enabled:true,idle_topic_seconds:300,proactive_cooldown_seconds:600,quiet_start:23,quiet_end:8});
  clock=new Date('2026-10-24T16:00:00Z');const quietCount=decisions.length;await bridge.tick();assert.equal(decisions.length,quietCount,'no unsolicited wake during quiet hours');
  clock=new Date('2026-10-25T04:00:00Z');policy=()=>({action:'skip'});await bridge.tick();await tick();assert.equal(decisions.at(-1).opportunity,'idle');assert.equal(decisions.at(-1).force,false);const afterWake=decisions.length;await tick();assert.equal(decisions.length,afterWake,'idle opportunities respect cooldown even when skipped');
  bridge.configure({idle_topic_enabled:false});advance(601000);event('新消息');await tick();await tick(61000);await tick();assert.equal(decisions.at(-1).opportunity,'random','random wake is an opportunity, not a forced reply');
  assert.equal(bridge.status().paused,false);assert.equal(bridge.status().group_daily_limit,100);
  console.log('qq-social: burst batching, speaker boundaries, reply/wait/skip, @ priority, decision throttling, stale output cancellation, topic expiry, quiet hours and autonomous idle/random opportunities passed.');
 }finally{await bridge.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
