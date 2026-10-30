'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-collection-retry-'));let store,bridge,clock=new Date('2026-10-24T12:00:00Z'),failures=1,fetches=0,upstreamStatus=0;
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
 function open(){store=new ConversationStore(root);bridge=createQQBridge({root,store,autoTick:false,now:()=>clock,getPlayerName:()=> 'owner',chat:()=>{throw Error('must never generate');},
 capabilitiesOptions:{requestJson:async()=>{if(upstreamStatus)throw Object.assign(Error('provider response'),{statusCode:upstreamStatus});return {choices:[{message:{content:'{"description":"微笑表情","is_sticker":true}'}}]};},fetchPublic:async()=>{fetches++;if(failures-->0)throw Object.assign(Error('temporary'),{code:'qq_public_fetch_failed'});return {bytes:image};}},
 request:async(url)=>{assert.ok(url.endsWith('/get_msg'),'must never send');return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_type:'private',user_id:111111,message:[{type:'image',data:{file:'https://qpic.cn/test.png'}}]}})};}});}
 const event=id=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:id,message:[{type:'image',data:{file:'opaque.png'}}]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));};
 const tick=async(ms=0)=>{clock=new Date(clock.getTime()+ms);await bridge.tick();};
 try{
 open();bridge.configure({enabled:true,collection_only:true,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',vision_enabled:true,vision_api_key:'fixture',stickers_enabled:true});
 event(1);await tick();assert.equal(bridge.status().pending,1);assert.equal(bridge.status().collection_status.status,'qq_public_fetch_failed');assert.equal(bridge.status().collection_failed,0);await tick(5000);assert.equal(fetches,1,'retry uses a delayed queue, not a tight loop');await tick(6000);assert.equal(bridge.status().pending,0);assert.equal(bridge.status().owner_sticker_count,1);assert.equal(bridge.status().collection_status.attempts,2);
 await bridge.close();store.close();open();assert.equal(bridge.status().collection_status.attempts,2,'audit survives restart');assert.equal(bridge.status().paused,true);
 failures=100;event(2);await tick();await tick(11000);await tick(21000);assert.equal(bridge.status().collection_failed,1);assert.equal(bridge.status().collection_status.attempts,3);assert.equal(bridge.status().pending,0);const count=fetches;await tick(60000);assert.equal(fetches,count,'exhausted failures do not loop or pretend to be collected');
 failures=0;upstreamStatus=400;event(3);await tick();assert.equal(bridge.status().collection_failed,2);assert.equal(bridge.status().collection_status.status,'qq_model_http_400');assert.equal(bridge.status().collection_status.attempts,1,'non-transient provider rejections are not retried');upstreamStatus=0;
 for(let n=10;n<40;n++)assert.equal(event(n).accepted,true,'owner image collection accommodates a burst larger than the 20-chat queue');
 assert.equal(bridge.status().pending,30);assert.equal(store.outbox().length,0);assert.equal(store.messages('desktop-pet').length,0);
 console.log('qq-collection-retry: delayed bounded retries, durable audit/restart, explicit exhausted failure, burst queue and zero generation/delivery passed.');
 }finally{await bridge?.close();store?.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
