'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-group-parts-'));process.env.LILITH_AI_DATA_DIR=root;
let app,clock=Date.now(),calls=0,id=0,fail=false;const sent=[],text='这个说法有点意思。莉莉丝也想听听后面的理由。';
(async()=>{try{
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({media:{enabled:false},conversation:{reply_max_chars:400},integrations:{dsh:{executable:process.execPath}}}));
 const {createApp}=require('../src/server');app=createApp({replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory:o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){
  if(prompt.includes('可信宿主输出提醒')){calls++;assert.match(prompt,/messages/);assert.match(prompt,/at most 240 Unicode characters/);}
  o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify({text,messages:[{text,emotion:'happy',animation:'smile'}]})}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 },async close(){this.exited=true;}})},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{
  if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};
  sent.push(JSON.parse(init.body));return {ok:true,json:async()=>{if(fail)throw Error('fixture unknown receipt');return {status:'ok',retcode:0,data:{message_id:sent.length}}}};
 }}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 app.qq.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',group_enabled:true,group_ids:['444444','555555'],participation_mode:'mention',mind_mode:'active',api_url:'http://127.0.0.1:1',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000});
 function event(group='444444',user='333333'){const raw=JSON.stringify({post_type:'message',message_type:'group',self_id:222222,user_id:Number(user),group_id:Number(group),message_id:++id,sender:{card:'群友'},message:[{type:'at',data:{qq:222222}},{type:'text',data:{text:'这个观点呢？'}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));}
 const tick=async()=>{clock+=3000;await app.qq.tick();};const flush=async()=>{app.store.db.exec("UPDATE reply_batches SET next_at=0 WHERE state='pending'");await app.flushReplyParts();};
 assert.equal((await fetch(base+'/v1/dsh/reply-parts')).status,401);
 const status=await(await fetch(base+'/v1/dsh/reply-parts',{headers:{Authorization:'Bearer '+app.token}})).json();assert.equal(status.group_single_part_fallback,'sentence_and_paragraph_v1');
 assert.equal(event().accepted,true);await tick();assert.equal(calls,1);assert.equal(sent.length,1);assert.equal(sent[0].group_id,'444444');assert.equal(sent[0].message.filter(p=>p.type==='text').map(p=>p.data.text).join(''),'这个说法有点意思。');
 await flush();await tick();assert.equal(calls,1,'local group repair never generates twice');assert.equal(sent.length,2);assert.equal(sent[1].message[0].type,'text','continuations are independent messages');assert.equal(sent[1].message[0].data.text,'莉莉丝也想听听后面的理由。');
 const session='qq-group:222222:444444',assistant=app.store.recent(session).filter(r=>r.role==='assistant');assert.equal(assistant.map(r=>r.content).join(''),text);assert.deepEqual(assistant.map(r=>r.reply_part.index),[0,1]);assert.equal(app.qq.status().group_daily_used,2,'physical send quota remains enforced');
 const turns=app.store.db.prepare('SELECT result FROM turns WHERE session=?').all(session);assert.equal(JSON.parse(turns[0].result).reply_batch.source,'local_group_fallback');
 event();await tick();let pending=app.store.db.prepare("SELECT id FROM reply_batches WHERE channel='qq_group' AND state='pending'").get();assert.ok(pending);event('555555');assert.equal(app.store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(pending.id).state,'pending','another group cannot cancel this burst');
 event('444444','666666');assert.equal(app.store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(pending.id).state,'cancelled','new same-group input cancels unsent tail');
 // Remove pending synthetic inputs before testing live disable and unknown receipt.
 app.store.db.exec("UPDATE inbox SET state='done' WHERE state='pending'");
 event();await tick();app.qq.configure({group_enabled:false});await flush();const before=sent.length;await tick();assert.equal(sent.length,before,'group disable cancels queued continuation');
 app.qq.configure({group_enabled:true});event();await tick();await flush();fail=true;await tick();assert.equal(app.qq.status().paused,true,'unknown group receipt pauses delivery');const count=sent.length;fail=false;await tick();assert.equal(sent.length,count);
 console.log('group-reply-parts: single-item JSON repaired through real group inbox, one generation, sequential receipts, complete content, group isolation, new-input cancellation, quota, disable and unknown pause passed (fake protocol)');
}finally{if(app){app.stopReplyParts();await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
