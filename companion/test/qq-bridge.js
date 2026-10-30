'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-qq-'));
process.env.LILITH_AI_DATA_DIR=root;
process.env.LILITH_AI_CONFIG=path.join(root,'config.json');
let offset=0;
let prompts=[],calls=0,sends=[],failSend=false;
(async()=>{
 const fake=http.createServer(async(req,res)=>{
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
   if(req.url==='/get_login_info')res.end(JSON.stringify({status:'ok',retcode:0,data:{user_id:222222}}));
   else if(['/send_private_msg','/send_group_msg'].includes(req.url)){sends.push(body);if(failSend){res.end('{}');return;}res.end(JSON.stringify({status:'ok',retcode:0,data:{message_id:100+sends.length}}));}
   else {calls++;prompts.push(body.messages);await new Promise(r=>setTimeout(r,20));res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'我记得你的计划。',emotion:'happy',animation:'smile',memory_updates:[{key:'旅行计划',value:'周六看海',evidence:'周六看海'}],art_action:{kind:'sticker',scene:'鼓励'},task_action:{kind:'delegate',goal:'读取文件'}})}}]}));}
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));const upstream=`http://127.0.0.1:${fake.address().port}`;
 fs.writeFileSync(process.env.LILITH_AI_CONFIG,JSON.stringify({mock_mode:false,media:{enabled:false},provider:{api_key:'fixture',kind:'deepseek',base_url:upstream,model:'fixture',wire_api:'chat_completions'},memory:{max_messages:4},integrations:{dsh:{enabled:true,transport:'stdio',executable:'/missing/dsh'},comfy:{enabled:true,autonomous_enabled:true}}}));
 const {createApp}=require('../src/server');const app=createApp({chatEngine:'provider-test',qqOptions:{autoTick:false,now:()=>new Date(Date.now()+offset),decide:async()=>({action:'reply'})}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 async function api(url,method='GET',body){const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 const secret='test-signature-key';
 async function event(id,changes={}){
   const e={post_type:'message',message_type:'private',sub_type:'friend',user_id:111111,self_id:222222,message_id:id,message:[{type:'text',data:{text:'我计划周六看海'}}],...changes};
   const raw=JSON.stringify(e),signature='sha1='+crypto.createHmac('sha1',secret).update(raw).digest('hex');
   const r=await fetch(base+'/onebot/events',{method:'POST',headers:{'X-Signature':signature},body:raw});return {status:r.status,body:await r.json()};
 }
 try{
   assert.equal((await fetch(base+'/v1/qq')).status,401);
   assert.equal((await api('/v1/qq','PATCH',{enabled:true})).status,400);
   assert.equal((await api('/v1/qq','PATCH',{api_url:'http://example.com/'})).status,400);
   assert.equal((await api('/v1/qq','PATCH',{enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'local-token',event_secret:secret,api_url:upstream,min_interval_ms:1000})).status,200);
   const state=(await api('/v1/qq')).body;assert.ok(!JSON.stringify(state).includes(secret));assert.equal(state.media_support,'text_only');assert.equal(state.release_stage,'beta');
   const qqPage=await (await fetch(base+'/ui/qq')).text();assert.match(qqPage,/QQ 桥接（测试版）/);assert.match(qqPage,/id="qq-form"/);assert.match(qqPage,/id="qq-groups"/);
   const bad=await fetch(base+'/onebot/events',{method:'POST',body:'{}'});assert.equal(bad.status,401);
   assert.equal((await event(1,{user_id:333333})).body.accepted,false);
   assert.equal((await event(2,{message_type:'group'})).body.accepted,false);
   assert.equal((await event(3,{post_type:'message_sent',user_id:222222})).body.accepted,false);
   assert.equal((await event(4)).body.duplicate,false);assert.equal((await event(4)).body.duplicate,true);
   await app.qq.tick();assert.equal(calls,1);assert.equal(sends.length,1);assert.equal(sends[0].user_id,'111111');
   assert.equal(app.tasks.list('desktop-pet').length,0);assert.equal(app.artwork.chatStickers('desktop-pet').length,0);
   const prompt=prompts[0][0].content;assert.match(prompt,/Identity canon:/);assert.doesNotMatch(prompt,/Local drawing is available|Local drawing is|TASK PLANNING|DSH task/);
   const history=(await api('/v1/session/desktop-pet/history')).body;assert.equal(history.messages.length,2);assert.equal(history.messages[0].channel,'qq');
   const cursor=history.cursor;assert.ok(cursor>0);assert.equal((await api('/v1/session/desktop-pet/events?after='+cursor)).body.messages.length,0);
   const facts=(await api('/v1/memory/archive')).body.facts;assert.equal(facts[0].evidence,'周六看海');assert.equal(facts[0].source_id,'desktop-pet:qq:222222:4:user');
   const payload={message:'好，就这样安排',request_id:'desktop-one',player:{name:'新称呼'},task_mode:'chat'};
   const [a,b]=await Promise.all([api('/v1/session/desktop-pet/message','POST',payload),api('/v1/session/desktop-pet/message','POST',payload)]);
   assert.equal(a.status,200);assert.deepEqual(a,b);assert.equal(calls,2);
   assert.equal((await api('/v1/session/desktop-pet/message','POST',{...payload,message:'不同消息'})).status,409);
   assert.match(prompts[1][0].content,/周六看海/);assert.equal(a.body.persona_hash,state.persona_hash);
   const newEvents=(await api('/v1/session/desktop-pet/events?after='+cursor)).body;assert.equal(newEvents.messages.length,2);
   await new Promise(r=>setTimeout(r,1010));await app.qq.tick();assert.equal(sends.length,2);assert.match(sends[1].message[0].data.text,/电脑端对话同步/);
   assert.equal((await event(5,{message:[{type:'image',data:{file:'x'}}]})).body.accepted,true);await app.qq.tick();assert.equal(calls,2);
   await new Promise(r=>setTimeout(r,1010));await app.qq.tick();assert.equal(sends.length,3);assert.match(sends[2].message[0].data.text,/不能识别/);
   // Group contexts must never inherit private owner history/facts or desktop memory files.
   await api('/v1/qq','PATCH',{quiet_ms:0,group_enabled:true,group_ids:['444444']});
   await new Promise(r=>setTimeout(r,1010));
   assert.equal((await event(600,{message_type:'group',group_id:444444,user_id:333333,message:[{type:'at',data:{qq:'222222'}},{type:'text',data:{text:'你好，介绍一下自己'}}]})).body.accepted,true);
   await app.qq.tick();assert.equal(calls,3);
   assert.doesNotMatch(JSON.stringify(prompts.at(-1)),/周六看海|新称呼/);
   assert.match(prompts.at(-1)[0].content,/GROUP CHAT/);
   assert.equal(app.store.recent('qq-group:222222:444444').length,2);
   assert.equal((await api('/v1/session/desktop-pet/history')).body.messages.some(m=>m.content.includes('群成员')),false);
   for(const user of [333333,555555]){
     offset+=10000;
     await event(601+user,{message_type:'group',group_id:444444,user_id:user,sender:{card:'同名群友'},message:[{type:'text',data:{text:'我计划周六看海'}}]});
     await app.qq.tick();
   }
   const groupFacts=app.store.facts('qq-group:222222:444444');
   assert.ok(groupFacts.some(f=>f.key==='333333:旅行计划'));
   assert.ok(groupFacts.some(f=>f.key==='555555:旅行计划'));
   assert.ok(groupFacts.every(f=>f.source_id.startsWith('qq-group:222222:444444:')));
   // Trigger deterministic mock extractive summary; archive exceeds the recent context window.
   await api('/v1/settings','PATCH',{mock_mode:true,integrations:{comfy:{enabled:false}}});
   for(let i=0;i<8;i++)await api('/v1/session/desktop-pet/message','POST',{request_id:'summary-'+i,message:'今天讨论旅行计划第'+i+'步',task_mode:'chat'});
   const archived=(await api('/v1/memory/archive')).body;assert.ok(archived.summaries.length>0);
   const rows=app.store.messages('desktop-pet');assert.ok(rows.length>4);
   for(const summary of archived.summaries)for(const item of summary.body)assert.ok(rows.find(m=>m.id===item.source_id).content.includes(item.quote));
   assert.throws(()=>app.store.saveSummary('desktop-pet',rows,[{source_id:'fabricated',quote:'虚构'}]),/summary_without_evidence/);
   await api('/v1/player-memory','PUT',{facts:[]});assert.equal((await api('/v1/memory/archive')).body.summaries.length,0);
   assert.equal(app.store.pendingSummary('desktop-pet',4).length,0,'deleted derived memories must not be rebuilt from old archive');
   // Unknown receipt is durable and never blindly resent.
   await new Promise(r=>setTimeout(r,1010));failSend=true;await app.qq.tick();
   const afterFailure=app.qq.status();assert.equal(afterFailure.paused,true);assert.ok(afterFailure.outbox.some(o=>o.state==='unknown'));
   const sent=sends.length;await app.qq.tick();assert.equal(sends.length,sent);
   // A pending generation recovered after a crash is not charged/generated a second time.
   app.store.begin('other','crash',{message:'once'});app.store.interrupt('other','crash');assert.throws(()=>app.store.begin('other','crash',{message:'once'}),/request_interrupted/);
   console.log('qq-bridge: signed intake, owner-only private chat, echo/dedup, shared persona/context, serial commits, full archive, sourced summaries, deletion and unknown-receipt pause passed (local mock protocol only).');
 }finally{await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));await new Promise(r=>fake.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
