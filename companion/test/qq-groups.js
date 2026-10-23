'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store');
const {createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-groups-'));let store,bridge,clock=new Date('2026-10-22T10:00:00Z'),sends=[],generations=0,fail=false;
 const request=async(url,opts)=>({ok:true,json:async()=>url.endsWith('/get_login_info')?{status:'ok',retcode:0,data:{user_id:222222}}:(sends.push({url,body:JSON.parse(opts.body)}),fail?{}:{status:'ok',retcode:0,data:{message_id:sends.length}})});
 function open(){store=new ConversationStore(root);bridge=createQQBridge({root,store,autoTick:false,now:()=>clock,request,getPlayerName:()=> 'OWNER_PRIVATE_CANARY',chat:async(session,body,channel)=>{
   generations++;assert.equal(channel,'qq_group');assert.equal(body.player.name,'群成员333333');assert.match(body.message,/群成员 QQ/);
   const delivery=bridge.mirror(channel,body.message,{text:'群聊回复'},session);if(delivery)store.enqueue(session,body.request_id,delivery.target,delivery.text);
 }});}
 const secret='fixture-secret';let id=0;
 function event({group='444444',mention=false,segments,other={}}={}){const e={post_type:'message',message_type:'group',self_id:222222,user_id:333333,group_id:group,message_id:++id,message:segments||[...(mention?[{type:'at',data:{qq:'222222'}}]:[]),{type:'text',data:{text:'你好'}}],...other};const raw=JSON.stringify(e);return bridge.accept(raw,'sha1='+crypto.createHmac('sha1',secret).update(raw).digest('hex'));}
 async function tick(){clock=new Date(clock.getTime()+61000);await bridge.tick();}
 try{
  open();bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:secret,api_url:'http://127.0.0.1:6190',group_enabled:true,group_ids:['444444','555555'],min_interval_ms:1000});
  assert.throws(()=>bridge.configure({group_ids:['invalid']}),/invalid_group_ids/);
  assert.equal(event({group:'666666',mention:true}).accepted,false);
  assert.equal(event().reason,'mention_required');
  assert.equal(event({segments:[{type:'at',data:{qq:'all'}}]}).reason,'mention_required');
  assert.equal(event({mention:true,other:{user_id:222222}}).accepted,false);
  assert.equal(event({mention:true}).accepted,true);await tick();
  assert.equal(bridge.status().group_daily_used,1);
  await bridge.close();store.close();open(); // Both round slots and quota survive process restart.
  assert.equal(bridge.status().group_daily_used,1);
  for(let n=0;n<9;n++){assert.equal(event({mention:n===0}).accepted,true);await tick();}
  assert.equal(event().reason,'mention_required','repeated @ must not reset active round');
  assert.equal(generations,10);assert.equal(sends.length,10);
  assert.ok(sends.every(s=>s.url.endsWith('/send_group_msg')&&s.body.group_id==='444444'&&!s.body.user_id));
  // Dedup reserves only one slot, including after a service restart.
  assert.equal(event({group:'555555',mention:true,other:{message_id:999}}).accepted,true);
  assert.equal(event({group:'555555',mention:true,other:{message_id:999}}).duplicate,true);await tick();
  for(let n=11;n<50;n++){const group=n%2?'444444':'555555';assert.equal(event({group,mention:true}).accepted,true);await tick();}
  assert.equal(sends.length,50);assert.equal(bridge.status().group_daily_used,50);
  assert.equal(event({mention:true}).reason,'group_daily_limit');assert.equal(event({group:'555555',mention:true}).reason,'group_daily_limit');
  await bridge.close();store.close();open();assert.equal(bridge.status().group_daily_used,50);
  clock=new Date('2026-10-22T16:00:01Z');assert.equal(bridge.status().group_daily_used,0,'reset at Beijing midnight');
  assert.equal(event({mention:true,segments:[{type:'at',data:{qq:'222222'}},{type:'file',data:{url:'http://do-not-fetch.invalid'}}]}).accepted,true);
  const before=generations;await tick();assert.equal(generations,before,'files never reach generation or download');assert.match(sends.at(-1).body.message[0].data.text,/不能识别/);
  assert.equal(bridge.status().group_daily_used,1);
  assert.equal(event({mention:true}).accepted,true);fail=true;await tick();assert.equal(bridge.status().paused,true);assert.equal(bridge.status().group_daily_used,2,'unknown receipts charged');
  const sent=sends.length;await tick();assert.equal(sends.length,sent);
  bridge.configure({paused:false,group_enabled:false});assert.equal(event({mention:true}).accepted,false);
  console.log('qq-groups: mention gate, whitelist, 10 replies, repeated @, durable dedup/rounds, global 50/day, restart, Beijing midnight, file rejection, unknown-receipt quota and pause passed.');
 }finally{await bridge?.close();store?.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
