'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-private-sticker-'));let store=new ConversationStore(root),bridge;
 let clock=new Date('2026-10-25T01:00:00Z'),id=0,selection='valid',calls=0,sends=[],fail=false,onProbe,mediaContexts=[];
 const own=crypto.createHash('sha256').update('owner-sticker').digest('hex'),foreign=crypto.createHash('sha256').update('foreign-sticker').digest('hex');
 const options=()=>({root,store,autoTick:false,now:()=>clock,getPlayerName:()=> 'owner',getCanon:()=>({identity:['莉莉丝'],traits:['温柔、好奇']}),getProvider:()=>({mock_mode:false,provider:{kind:'deepseek',api_key:'fixture',base_url:'https://example.com/v1',model:'fixture'}}),
  capabilitiesOptions:{requestJson:async(_url,body)=>{calls++;assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.response_format.type,'json_object');assert.ok(body.max_tokens>=256);const input=JSON.parse(body.messages[1].content);assert.ok(input.stickers.every(s=>s.id===own),'only owner library reaches selector');assert.match(body.messages[0].content,/固定身份和性格/);if(selection==='failure')throw Error('fixture_failure');return {choices:[{message:{content:selection==='malformed'?'invalid':JSON.stringify({sticker_id:selection==='valid'?own:selection==='foreign'?foreign:null})}}]};}},
  request:async(url,options)=>{if(url.endsWith('/get_login_info')){if(onProbe){const fn=onProbe;onProbe=null;fn();}return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};}assert.ok(url.endsWith('/send_private_msg'));const payload=JSON.parse(options.body);sends.push(payload);return {ok:true,json:async()=>{if(fail&&payload.message.some(s=>s.type==='image'))throw Error('fixture_unknown');return {status:'ok',retcode:0,data:{message_id:sends.length}};}};},
  chat:async(session,body,channel)=>{assert.equal(channel,'qq');mediaContexts.push(body._qq_media);const output=bridge.mirror(channel,body.message,{text:'当然，慢慢来。'},session);if(output)store.enqueue(session,body.request_id,output.target,output.text);}
 });
 const event=(text='今天很开心',user=111111,eventId=++id)=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:eventId,message:[{type:'text',data:{text}}]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));};
 const tick=async(text)=>{event(text);clock=new Date(clock.getTime()+2000);await bridge.tick();
  if(store.db.prepare("SELECT 1 FROM outbox o JOIN qq_delivery_meta m ON o.id=m.id WHERE o.state='pending' AND json_extract(m.body,'$.sticker_only')=1").get()){clock=new Date(clock.getTime()+2000);await bridge.tick();}};
 const hasImage=payload=>payload.message.some(s=>s.type==='image');
 try{
  bridge=createQQBridge(options());bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',mirror_desktop:false,group_enabled:false,stickers_enabled:true,mind_mode:'active',min_interval_ms:1000,max_per_minute:20});
  const dir=path.join(root,'qq-media');for(const [image,scope]of[[own,'private:111111'],[foreign,'group:444444']]){const file=path.join(dir,image+'.png');fs.writeFileSync(file,Buffer.from('mock-image'));store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(image,scope,file,'image/png','开心，赞同',clock.toISOString());}
  assert.equal(bridge.status().private_stickers_enabled,false);
  await tick();await tick();assert.equal(calls,0);assert.ok(sends.every(x=>!hasImage(x)));
  bridge.configure({private_stickers_enabled:true});await tick();assert.equal(calls,1);assert.ok(hasImage(sends.at(-1)));assert.equal(mediaContexts.at(-1).planned_sticker,null,'the dialogue must not promise a sticker before its reply exists');assert.equal(mediaContexts.at(-1).selection_timing,'after_reply');
  assert.deepEqual(sends.at(-1).message.map(s=>s.type),['image'],'sticker is an independent unquoted message');assert.deepEqual(sends.at(-2).message.map(s=>s.type),['text'],'text has a separate confirmed receipt');
  await tick();assert.equal(mediaContexts.at(-1).recent_image_deliveries.at(-1).image_state,'sent');assert.equal(mediaContexts.at(-1).recent_image_deliveries.at(-1).description,'开心，赞同');await tick();assert.equal(calls,1);await tick();assert.ok(hasImage(sends.at(-1)));assert.equal(calls,2);
  const n=sends.length;assert.equal(event('重复消息',111111,id).duplicate,true);await bridge.tick();assert.equal(sends.length,n);
  await tick();await tick();selection='foreign';await tick();assert.equal(hasImage(sends.at(-1)),false,'invalid/cross-scope model choice is rejected');
  selection='valid';await tick();assert.ok(hasImage(sends.at(-1)));const countBefore=calls;await tick('我今天有点难过');await tick('帮我分析故障');assert.equal(calls,countBefore,'serious messages do not enter the sticker selector');
  // An uncertain image consumes the slot durably, even if replies are explicitly resumed later.
  fail=true;await tick();assert.equal(bridge.status().paused,true);assert.ok(hasImage(sends.at(-1)));assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM qq_private_deliveries WHERE state='unknown' AND sticker=1").get().n,1);
  await bridge.close();store.close();store=new ConversationStore(root);bridge=createQQBridge(options());fail=false;bridge.configure({paused:false});
  await tick();assert.equal(hasImage(sends.at(-1)),false);assert.equal(mediaContexts.at(-1).recent_image_deliveries.at(-1).image_state,'unknown');await tick();assert.equal(hasImage(sends.at(-1)),false);await tick();assert.ok(hasImage(sends.at(-1)),'two confirmed replies separate image attempts after restart');
  for(let k=0;k<sends.length;k++)assert.ok(sends.slice(k,k+3).filter(hasImage).length<=1,'at most one image in every rolling three replies');
  await tick();await tick();onProbe=()=>bridge.configure({private_stickers_enabled:false});await tick();assert.equal(hasImage(sends.at(-1)),false,'revocation during identity probe removes the image while preserving text');
  bridge.configure({private_stickers_enabled:true});selection='failure';await tick();assert.equal(hasImage(sends.at(-1)),false);assert.equal(bridge.status().paused,false,'selector outage does not break text replies');
  selection='malformed';await tick();assert.equal(hasImage(sends.at(-1)),false);selection='none';await tick();assert.equal(hasImage(sends.at(-1)),false,'model can choose no image even when eligible');
  assert.equal(event('陌生人',333333).accepted,false);
  const historical=store.db.prepare("SELECT m.id,m.body FROM qq_delivery_meta m JOIN qq_private_deliveries d ON d.id=m.id WHERE d.sticker=1 ORDER BY d.seq DESC LIMIT 1").get();
  const oldMeta=JSON.parse(historical.body);oldMeta.sticker_id='5187f5ebaf67d6de0db593acd65dec6489f4791271186b8099d5df1b76ff1699';oldMeta.sticker_description='两个人偶温柔拥抱';
  store.db.prepare('UPDATE qq_delivery_meta SET body=? WHERE id=?').run(JSON.stringify(oldMeta),historical.id);
  await tick('那表情是在欺负我吗');
  assert.ok(mediaContexts.at(-1).recent_image_deliveries.some(d=>d.description.includes('恼羞成怒')&&d.description.includes('不是拥抱')),'old delivery snapshot uses owner-corrected semantics');
  const before=sends.length,modelBefore=calls;bridge.configure({collection_only:true});assert.equal(event().accepted,false);await bridge.tick();assert.equal(sends.length,before);assert.equal(calls,modelBefore);
  assert.equal(bridge.status().group_enabled,false);assert.equal(bridge.status().group_daily_used,0);
  assert.ok(mediaContexts.some(m=>m.recent_image_deliveries.some(d=>d.image_state==='not_sent')),'a selected but revoked image is not reported as delivered');
  for(const m of mediaContexts)assert.doesNotMatch(JSON.stringify(m),/foreign-sticker|group:444444|base64:|qq-media/,'feedback contains descriptions and state, never image bytes or local paths');
  console.log('qq-private-stickers: owner-only candidate selection, opt-in, model decline/failure, text fallback, rolling-3 cadence, restart/unknown receipts, permission recheck, dedup and paused collection isolation passed.');
 }finally{await bridge?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
