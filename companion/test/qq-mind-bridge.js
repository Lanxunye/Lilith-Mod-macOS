'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-mind-bridge-')),store=new ConversationStore(root);
 let clock=new Date('2026-10-24T04:00:00Z'),id=0,decisions=[],chats=[],sends=[],failSend=false,onChat;
 const bridge=createQQBridge({root,store,autoTick:false,now:()=>clock,getPlayerName:()=> 'owner',
  decide:async input=>{decisions.push(input);return {action:'reply',topic:'茶'};},
  request:async(url,options)=>({ok:true,json:async()=>{
   if(url.endsWith('/get_login_info'))return {status:'ok',retcode:0,data:{user_id:222222}};
   if(url.endsWith('/get_msg'))return {status:'ok',retcode:0,data:{message_type:'group',group_id:444444,sender:{user_id:222222},message:[{type:'text',data:{text:'上一条机器人发言'}}]}};
   sends.push(JSON.parse(options.body));if(failSend)throw Error('fixture_timeout');return {status:'ok',retcode:0,data:{message_id:sends.length}};
  }}),
  chat:async(session,body,channel)=>{chats.push(body);if(onChat)onChat();const out=bridge.mirror(channel,body.message,{text:'可以，慢慢说。'},session);if(out)store.enqueue(session,body.request_id,out.target,out.text);}
 });
 const event=(text,{user=333333,force=false,group=444444,quote=false,privateMessage=false,image=false}={})=>{
  const raw=JSON.stringify({post_type:'message',message_type:privateMessage?'private':'group',sub_type:'friend',self_id:222222,user_id:privateMessage?111111:user,group_id:group,message_id:++id,sender:{card:'同名成员'},message:[...(force?[{type:'at',data:{qq:222222}}]:[]),...(quote?[{type:'reply',data:{id:'1'}}]:[]),...(image?[{type:'image',data:{file:'fixture.png'}}]:[]),{type:'text',data:{text}}]});
  return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));
 };
 const tick=async()=>{clock=new Date(clock.getTime()+10000);await bridge.tick();};
 try{
  bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',group_enabled:true,group_ids:['444444','555555'],quiet_ms:0,min_interval_ms:1000});
  assert.equal(bridge.status().mind_mode,'observe');
  event('莉莉丝，请别打扰我了');await tick();assert.equal(sends.length,1);assert.equal(chats.at(-1)._qq_mind,null);
  event('普通闲聊');await tick();assert.equal(sends.length,2,'shadow decision does not change baseline');assert.ok(bridge.mind.status().audit.some(a=>a.recommended==='skip'&&a.effective==='reply'));
  bridge.configure({mind_mode:'active'});
  const calls=decisions.length;event('普通闲聊');await tick();assert.equal(decisions.length,calls,'known quiet boundary avoids a provider call');assert.equal(sends.length,2);
  event('请解释这个问题',{force:true});await tick();assert.equal(sends.length,3);assert.equal(decisions.at(-1).mind.relation.tier,'reserved');assert.equal(chats.at(-1)._qq_mind.state.member,'333333');
  assert.equal(bridge.mind.snapshot('group:444444','333333').relation.interactions,3,'only receipts create familiarity');
  event('莉莉丝，不要回复这条');await tick();assert.equal(sends.length,3,'explicit no-reply request works even with a direct address');
  event('普通消息',{user:555555});await tick();assert.equal(sends.length,4,'same nickname is not a shared quiet boundary');
  event('另一群的话题',{group:555555});await tick();assert.equal(sends.length,5,'quiet does not cross group scopes');
  event('引用你继续提问',{quote:true});await tick();assert.equal(sends.length,6,'same-group quoted bot counts as direct interaction');
  bridge.mind.memberControl({scope:'group:444444',member:'333333',action:'resume'});
  onChat=()=>{onChat=null;bridge.mind.memberControl({scope:'group:444444',member:'333333',action:'quiet'});};
  const interactions=bridge.mind.snapshot('group:444444','333333').relation.interactions;
  event('生成中变更少打扰边界');await tick();assert.equal(sends.length,6);assert.equal(bridge.mind.snapshot('group:444444','333333').relation.interactions,interactions,'cancelled output does not count');assert.ok(store.outbox().some(x=>x.error==='qq_mind_boundary'));
  event('请不要回复这条',{privateMessage:true});await tick();assert.equal(sends.length,6);event('这个问题呢',{privateMessage:true});await tick();assert.equal(sends.length,7,'private no-reply applies only to that message, not 24 hours');
  const beforeEnergy=bridge.mind.snapshot('group:444444','333333').energy;
  failSend=true;event('请回答',{force:true});await tick();assert.equal(bridge.status().paused,true);assert.equal(store.outbox().filter(x=>x.state==='unknown').length,1);assert.ok(bridge.mind.snapshot('group:444444','333333').energy>=beforeEnergy,'unknown receipt does not deplete state or add intimacy');
  const before=sends.length,counts=store.db.prepare('SELECT COUNT(*) AS n FROM qq_mind_audit').get().n;
  bridge.configure({collection_only:true,group_enabled:false,mirror_desktop:false,owner_stickers_enabled:false});
  assert.equal(event('群聊',{force:true}).accepted,false);assert.equal(event('私聊',{privateMessage:true}).accepted,false);await tick();
  assert.equal(sends.length,before);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM qq_mind_audit').get().n,counts,'collection mode never runs social observation or decisions');
  const preview=bridge.mindPreview({scope:'group:444444',member:'333333',text:'@测试',force:true,proposal:{action:'reply'}});assert.equal(preview.effective.action,'skip');assert.ok(preview.gates.includes('collection_only'));assert.equal(preview.sends,0);
  bridge.configure({collection_only:false,paused:false,group_enabled:true});failSend=false;
  store.db.prepare('INSERT OR REPLACE INTO qq_group_budget VALUES (?,?,100)').run('222222',bridge.status().group_day);
  assert.equal(event('请回答',{force:true}).reason,'group_daily_limit');await tick();assert.equal(sends.length,before,'100/day cannot be relaxed by familiarity or @');
  console.log('qq-mind-bridge: real pipeline with fake protocol/provider, observation parity, scoped boundaries, @/quotes, delivery accounting, output recheck, unknown receipt pause, collection-only isolation and quota passed.');
 }finally{await bridge.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
