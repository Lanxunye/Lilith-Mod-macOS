'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-plain-parts-'));process.env.LILITH_AI_DATA_DIR=root;
let app,clock=Date.now(),calls=0;const sent=[],text='回来啦。今天也来陪我待会儿吧。';
(async()=>{try{
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({mock_mode:false,media:{enabled:false},integrations:{dsh:{executable:process.execPath}}}));
 const pkg=path.join(root,'dsh-lilith/home/profiles/lilith/node_modules/dsh-fish-memory');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
 const {createApp}=require('../src/server');app=createApp({replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory:o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){
  calls++;assert.match(prompt,/不要因历史回复曾使用纯文本/);
  o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:text}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 },async close(){this.exited=true;}})},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{
  if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};
  sent.push(JSON.parse(init.body));return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:sent.length}})};
 }}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const flush=async()=>{app.store.db.exec("UPDATE reply_batches SET next_at=0 WHERE state='pending'");await app.flushReplyParts();};
 assert.equal((await fetch(base+'/v1/dsh/reply-parts')).status,401);
 assert.equal((await api('/v1/dsh/reply-parts')).data.fallback,'sentence_and_paragraph_v1');
 let r=await api('/v1/session/desktop-pet/message',{request_id:'plain-desktop',message:'我回来了。'});assert.equal(r.status,200);assert.equal(r.data.text,'回来啦。');assert.equal(r.data.reply_batch.source,'local_fallback');assert.equal(calls,1);
 await flush();assert.equal(calls,1);let rows=app.store.recent('desktop-pet');assert.deepEqual(rows.filter(x=>x.role==='assistant').map(x=>x.content),['回来啦。','今天也来陪我待会儿吧。']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'shared-chat-events.json'))).messages.at(-1).content,'今天也来陪我待会儿吧。');
 await api('/v1/qq',{enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_url:'http://127.0.0.1:1',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000},'PATCH');
 function event(id){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:id,message:[{type:'text',data:{text:'我回来了。'}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));}
 event(1);await app.qq.tick();assert.equal(calls,2);assert.equal(sent.length,1);assert.equal(sent[0].message[0].data.text,'回来啦。');await flush();clock+=2000;await app.qq.tick();assert.deepEqual(sent.map(p=>p.message[0].data.text),['回来啦。','今天也来陪我待会儿吧。']);assert.equal(calls,2);
 assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM qq_private_deliveries').get().n,1,'fallback parts remain one logical reply');
 r=await api('/v1/session/desktop-pet/message',{request_id:'interrupt',message:'再说一遍。'});event(2);
 assert.equal(app.store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(r.data.reply_batch.id).state,'cancelled');await flush();
 assert.equal(app.store.recent('desktop-pet').filter(x=>x.request_id==='interrupt:part:1').length,0,'new input cancels unsent fallback tail');
 console.log('reply-fallback-host: real plain-text shape now splits desktop/QQ once, preserves content, uses authenticated status and retains new-input cancellation/cadence (fake protocol)');
}finally{if(app){await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
