'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-collection-')),store=new ConversationStore(root);let actions=[],visionCalls=0,sticker=true,protocolSticker=false;
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
 const bridge=createQQBridge({root,store,autoTick:false,getPlayerName:()=> 'owner',chat:()=>{throw Error('collection must not chat');},
  decide:()=>{throw Error('collection must not decide to speak');},
  capabilitiesOptions:{requestJson:async()=>{visionCalls++;return {choices:[{message:{content:JSON.stringify({description:'笑脸',is_sticker:sticker})}}]};},fetchPublic:async()=>({bytes:image})},
  request:async(url)=>{const action=url.split('/').at(-1);actions.push(action);assert.equal(action,'get_msg','no outgoing/probe/other QQ API in collection-only mode');return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_type:'private',user_id:111111,message:[{type:'image',data:{file:'https://qpic.cn/test.png',sub_type:protocolSticker?1:0}}]}})};}
 });
 const event=(id,changes={})=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:id,message:[{type:'image',data:{file:'opaque.png'}}],...changes});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));};
 try{
  bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',group_enabled:true,group_ids:['444444'],vision_enabled:true,vision_api_key:'private-fixture',stickers_enabled:true});
  store.enqueue('desktop-pet','old','111111','stale text');
  bridge.configure({collection_only:true});assert.equal(bridge.status().paused,true);assert.equal(store.outbox()[0].state,'cancelled');
  assert.equal(event(1,{message_type:'group',group_id:444444}).accepted,false);assert.equal(event(2,{user_id:333333}).accepted,false);
  assert.equal(event(3,{message:[{type:'text',data:{text:'普通聊天'}}]}).reason,'collection_images_only');
  assert.equal(event(4).accepted,true);assert.equal(event(4).duplicate,true);await bridge.tick();assert.equal(visionCalls,1);assert.equal(bridge.status().owner_sticker_count,1);assert.equal(bridge.status().collection_status.stickers,1);
  assert.deepEqual(actions,['get_msg']);assert.equal(store.messages('desktop-pet').length,0);assert.equal(bridge.status().group_daily_used,0);
  assert.equal(bridge.mirror('desktop','private text',{text:'reply'},'desktop-pet'),null);assert.equal(bridge.mirror('qq','private text',{text:'reply'},'desktop-pet'),null);
  sticker=false;bridge.configure({vision_api_key:'private-fixture-v2'});assert.equal(event(5).accepted,true);await bridge.tick();assert.equal(bridge.status().owner_sticker_count,1,'ordinary images do not become stickers');
  protocolSticker=true;event(7);await bridge.tick();assert.equal(bridge.status().collection_status.stickers,1,'owner-curated QQ custom stickers remain stickers even if appearance classifier disagrees');
  bridge.configure({collection_only:false});assert.equal(event(6).accepted,false,'all intake stops when paused and collection is off');
  console.log('qq-collection: mute all replies, owner-only private images, media classification/cache, dedup, no generation/probe/send/group processing, no budget use, no mirroring and cancelled stale deliveries passed.');
 }finally{await bridge.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
