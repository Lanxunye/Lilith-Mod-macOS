'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-parts-host-'));process.env.LILITH_AI_DATA_DIR=root;
let app,clock=Date.now(),release,started;const prompts=[],sent=[];
(async()=>{try{
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({mock_mode:false,media:{enabled:false},integrations:{dsh:{executable:process.execPath}}}));
 const memory=path.join(root,'dsh-lilith/home/profiles/lilith/node_modules/dsh-fish-memory');fs.mkdirSync(memory,{recursive:true});fs.writeFileSync(path.join(memory,'package.json'),JSON.stringify({lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
 const {createApp}=require('../src/server');
 app=createApp({replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory:o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){
  prompts.push(prompt);if(started){started();started=null;await new Promise(r=>{release=r;});}
  const current=prompt.match(/"current_user_message":"([^"]*)"/)?.[1]||'';
  const text=current.includes('新话题')?'新话题第一条。':'回来啦。';
  o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify({text:text+'\n还知道找我呀。\n第三条。',messages:[{text,emotion:'happy'},{text:'还知道找我呀。',emotion:'shy'},{text:'第三条。'}],memory_updates:[]})}}});
  o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 },async close(){this.exited=true;}})},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{
  if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};
  const payload=JSON.parse(init.body);sent.push(payload);return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:sent.length}})};
 }}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const message=(id,text)=>api('/v1/session/desktop-pet/message',{request_id:id,message:text});
 let r=await message('first','我回来了。');assert.equal(r.status,200);assert.equal(r.data.text,'回来啦。');assert.equal(r.data.ui.emotion,'happy');assert.equal(r.data.reply_batch.total,3);assert.equal(r.data.messages,undefined);assert.equal(prompts.length,1);
 assert.equal(app.store.recent('desktop-pet').length,2,'only first assistant message is in history');
 const due=()=>app.store.db.exec("UPDATE reply_batches SET next_at=0 WHERE state='pending'");
 const flush=async()=>{due();await app.flushReplyParts();};await flush();assert.equal(prompts.length,1);assert.equal(app.store.recent('desktop-pet').at(-1).content,'还知道找我呀。');
 let projection=JSON.parse(fs.readFileSync(path.join(root,'shared-chat-events.json')));assert.equal(projection.messages.at(-1).reply_part.emotion,'shy');assert.equal(projection.messages.at(-1).reply_part.index,1);
 const cached=await message('first','我回来了。');assert.equal(cached.data.reply_batch.id,r.data.reply_batch.id);assert.equal(prompts.length,1);assert.equal(app.store.db.prepare("SELECT state FROM reply_batches WHERE id=?").get(r.data.reply_batch.id).state,'pending','retries do not interrupt the same burst');
 await message('new','换个新话题。');assert.equal(app.store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(r.data.reply_batch.id).state,'cancelled');assert.equal(app.store.recent('desktop-pet').filter(x=>x.request_id==='first:part:2').length,0);
 projection=JSON.parse(fs.readFileSync(path.join(root,'shared-chat-events.json')));assert.ok(!projection.messages.some(x=>x.reply_part?.batch_id===r.data.reply_batch.id),'new input removes old queued desktop projection');
 await flush();await flush();assert.equal(prompts.length,2);assert.equal(app.store.recent('desktop-pet').filter(x=>x.request_id.startsWith('new')).length,4);
 await api('/v1/qq',{enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_url:'http://127.0.0.1:1',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000},'PATCH');
 const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:1,message:[{type:'text',data:{text:'我回来了。'}}]});
 app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));await app.qq.tick();assert.equal(sent.length,1);assert.equal(sent[0].message[0].data.text,'回来啦。');
 await flush();clock+=2000;await app.qq.tick();await flush();clock+=2000;await app.qq.tick();assert.deepEqual(sent.map(p=>p.message[0].data.text),['回来啦。','还知道找我呀。','第三条。']);
 assert.equal(prompts.length,3,'one chat generation per turn');assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM qq_private_deliveries').get().n,1,'three bubbles count as one logical private reply');
 // A new owner message can arrive during generation, before a batch exists.
 const began=new Promise(r=>{started=r;});const old=message('race-old','旧话题');await began;const newer=message('race-new','新话题');
 for(let n=0;n<100;n++){if(app.store.queues.has('conversation-core'))await new Promise(r=>setTimeout(r,2));if(n===10)break;}
 release();assert.equal((await old).data.reply_batch,undefined);assert.equal((await newer).status,200);
 const batches=app.store.db.prepare("SELECT * FROM reply_batches WHERE state='pending'").all();assert.equal(batches.length,1);assert.equal(batches[0].request_id,'race-new');
 await api('/v1/control',{action:'reset_session',session_id:'desktop-pet'});assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM reply_batches WHERE state='pending'").get().n,0);
 console.log('reply-parts: single generation, semantic first/tail messages, shared desktop projection, timing, retry, new input/racing generation cancellation, logical QQ cadence and reset passed (local fixtures)');
}finally{if(app){await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
