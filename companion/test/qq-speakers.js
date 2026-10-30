'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store');const {createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-speakers-'));const store=new ConversationStore(root);
 let bridge,clock=new Date('2026-10-22T10:00:00Z'),received=[],lookups=[],quote,fail=false,id=0;
 bridge=createQQBridge({root,store,autoTick:false,decide:async()=>({action:'reply'}),now:()=>clock,getPlayerName:()=> 'private owner',request:async(url,opts)=>{
   assert.ok(url.endsWith('/get_msg'),'no attachments or other APIs may be fetched');lookups.push(JSON.parse(opts.body));if(fail)throw Error('message retracted');return {ok:true,json:async()=>({status:'ok',retcode:0,data:quote})};
 },chat:async(session,body,channel)=>{received.push({session,body,data:JSON.parse(body.message.slice(body.message.indexOf('\n')+1)),channel});}});
 bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',api_url:'http://127.0.0.1:6190',group_enabled:true,group_ids:['444444']});
 async function incoming(user=333333,name='同名',extra=[],text='我喜欢茶'){
  const e={post_type:'message',message_type:'group',self_id:222222,user_id:user,group_id:444444,message_id:++id,sender:{user_id:user,card:name,nickname:'昵称'},message:[{type:'at',data:{qq:'222222'}},{type:'text',data:{text}},...extra]};const raw=JSON.stringify(e);
  assert.equal(bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex')).accepted,true);clock=new Date(clock.getTime()+61000);await bridge.tick();return received.at(-1);
 }
 try{
  let r=await incoming();assert.equal(r.data.speaker.qq,'333333');assert.equal(r.data.speaker.name,'同名');assert.equal(r.body.player.name,'同名');assert.equal(r.data.speaker.is_bound_owner,false);
  r=await incoming(555555);assert.equal(r.data.speaker.qq,'555555');assert.equal(r.data.speaker.name,'同名');assert.equal(r.data.speaker.is_bound_owner,false);
  r=await incoming(111111,'新名');assert.equal(r.data.speaker.is_bound_owner,true);
  r=await incoming(333333,'已改名');assert.equal(r.data.speaker.qq,'333333');assert.equal(r.data.speaker.name,'已改名');
  quote={message_type:'group',group_id:444444,message_id:77,sender:{user_id:555555,card:'引用作者'},message:[{type:'text',data:{text:'我喜欢咖啡'}}]};
  r=await incoming(333333,'同名',[{type:'reply',data:{id:'77'}}]);assert.equal(r.data.quote.speaker.qq,'555555');assert.equal(r.data.quote.text,'我喜欢咖啡');assert.equal(r.data.speaker.qq,'333333');assert.equal(r.data.text,'我喜欢茶');assert.deepEqual(lookups.at(-1),{message_id:'77'});
  quote.group_id=666666;quote.message[0].data.text='OTHER_GROUP_CANARY';r=await incoming(333333,'同名',[{type:'reply',data:{id:'77'}}]);assert.equal(r.data.quote.status,'unavailable');assert.doesNotMatch(r.body.message,/OTHER_GROUP_CANARY/);
  quote.group_id=444444;quote.message_type='private';r=await incoming(333333,'同名',[{type:'reply',data:{id:'77'}}]);assert.equal(r.data.quote.status,'unavailable');
  quote.message_type='group';quote.message=[{type:'image',data:{url:'http://never-fetch.invalid'}}];r=await incoming(333333,'同名',[{type:'reply',data:{id:'77'}}],'');assert.equal(r.data.quote.has_unsupported_media,true);assert.equal(r.data.quote.text,'');assert.doesNotMatch(r.body.message,/never-fetch/);
  fail=true;r=await incoming(333333,'同名',[{type:'reply',data:{id:'77'}}]);assert.equal(r.data.quote.status,'unavailable');assert.equal(bridge.status().paused,false);
  fail=false;quote.message=[{type:'text',data:{text:'长'.repeat(2000)}}];r=await incoming(333333,'名'.repeat(64),[{type:'reply',data:{id:'77'}}],'文'.repeat(1900));assert.ok(r.body.message.length<=2000);assert.ok(r.data.quote.text.length<=480);
  // Group fact keys preserve the source identity and summaries retain attribution.
  const session=r.session,body=r.body;store.begin(session,'fixture',{});store.commit(session,'fixture',body.message,{text:'收到'},'qq_group','fixture',null,{updates:[{key:'333333:喜好',value:'茶',evidence:'文文'}],sensitive:()=>false});
  assert.equal(store.facts(session)[0].key,'333333:喜好');const rows=store.messages(session);const excerpt=store.saveSummary(session,rows,[{source_id:rows[0].id,quote:'文文'}]);assert.equal(excerpt[0].speaker_qq,'333333');
  console.log('qq-speakers: stable IDs, same/changed names, bound owner, quoted author/text, cross-group/private denial, retraction, media refusal, bounded JSON, attributed memories and summaries passed.');
 }finally{await bridge.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
