'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-host-context-'));process.env.LILITH_AI_DATA_DIR=root;
const prompts=[],sent=[];let app,clock=Date.now(),id=0,kind='private';
(async()=>{try{
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({media:{enabled:false},integrations:{dsh:{executable:process.execPath}}}));
 const pkg=path.join(root,'dsh-lilith/home/profiles/lilith/node_modules/dsh-fish-memory');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
 app=require('../src/server').createApp({speechOptions:{autoTick:false},replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory:o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){
  const chat=prompt.includes('LILITH HOST CAPABILITIES');if(chat)prompts.push(prompt);
  const reply=!chat?{action:'reply'}:{text:'莉莉丝知道啦。',messages:[{text:'莉莉丝知道啦。'}],public_memory_updates:kind==='private'?[{key:'music_preference',value:'爵士乐',evidence:'我喜欢爵士乐'}]:kind==='owner-group'?[{key:'music_preference',value:'轻音乐',evidence:'我喜欢轻音乐'}]:kind==='quoted'?[{key:'music_preference',value:'金属乐',evidence:'我喜欢金属乐'}]:[],memory_updates:[]};
  o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify(reply)}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 },async close(){this.exited=true;}})},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{
  if(url.endsWith('/get_msg'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_type:'private',message_id:77,user_id:111111,sender:{user_id:222222},message:[{type:'text',data:{text:'我喜欢金属乐'}}]}})};
  if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};
  sent.push(JSON.parse(init.body));return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:sent.length}})};
 }}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 app.qq.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',group_enabled:true,group_ids:['444444'],mind_mode:'active',participation_mode:'mention',voice_enabled:false,group_voice_enabled:false,api_url:'http://127.0.0.1:1',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000});
 assert.equal((await fetch(base+'/v1/context/capabilities')).status,401);
 assert.equal((await api('/v1/context/capabilities?channel=qq_group&session=qq-group:222222:999999')).status,400);
 let res=await api('/v1/session/desktop-pet/message',{request_id:'private-1',message:'我喜欢爵士乐。私聊经历PRIVATE_EVENT_CANARY不能当成偏好。'});assert.equal(res.status,200);assert.match(prompts.at(-1),/public_memory_updates/);assert.match(prompts.at(-1),/"time":\{"available":true,"current":/,'time arrives even without a keyword');
 function event(user,text){const raw=JSON.stringify({post_type:'message',message_type:'group',self_id:222222,user_id:user,group_id:444444,message_id:++id,sender:{card:'同名主人'},message:[{type:'at',data:{qq:222222}},{type:'text',data:{text}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));}
 const tick=async()=>{clock+=3000;await app.qq.tick();};
 kind='owner-group';event(111111,'我喜欢轻音乐。');await tick();let prompt=prompts.at(-1);assert.match(prompt,/爵士乐/);assert.doesNotMatch(prompt,/PRIVATE_EVENT_CANARY/);assert.match(prompt,/"channel":"qq_group"/);assert.match(prompt,/"time":\{"available":true/);
 kind='other-group';event(333333,'你记得主人喜欢什么吗？');await tick();prompt=prompts.at(-1);assert.ok(!prompt.includes('LILITH OWNER PUBLIC FACTS'),'other members do not get private/shared owner recall');
 kind='after';res=await api('/v1/session/desktop-pet/message',{request_id:'private-2',message:'还记得我的音乐偏好吗？'});assert.equal(res.status,200);assert.match(prompts.at(-1),/LILITH OWNER PUBLIC FACTS[^]*轻音乐/);
 const old=(await api('/v1/context/capabilities?channel=qq')).data;app.qq.configure({voice_enabled:true,voice_mode:'gentle'});const next=(await api('/v1/context/capabilities?channel=qq')).data;assert.notEqual(old.revision,next.revision);assert.equal(next.capabilities.voice.enabled,true);
 assert.ok(next.recent_deliveries.every(d=>d.kind!=='voice'),'text records are not promoted to spoken audio');assert.equal((await api('/v1/dsh/memory/public')).data.count,2);
 kind='quoted';app.qq.configure({voice_enabled:false});
 function privateReply(text){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:++id,message:[{type:'reply',data:{id:'77'}},...(text?[{type:'text',data:{text}}]:[])]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));}
 assert.equal(privateReply('这句旧话是什么意思？').accepted,true);await tick();prompt=prompts.at(-1);assert.match(prompt,/单层历史引用/);assert.match(prompt,/"speaker":\{"role":"lilith"/);assert.match(prompt,/我喜欢金属乐/);assert.match(prompt,/"current_memory_text":"这句旧话是什么意思？"/);assert.equal((await api('/v1/dsh/memory/public')).data.count,2,'quoted bot preference is not a new public owner fact');
 assert.equal(privateReply('').accepted,true);await tick();prompt=prompts.at(-1);assert.match(prompt,/"current_memory_text":""/);assert.ok(!app.store.recent('desktop-pet').filter(m=>m.role==='user').at(-1).content.includes('金属乐'),'quote does not become owner assertion in journal');assert.equal(app.dsh.approvals.list().length,0);
 console.log('host-context-integration: authenticated live snapshots, time without keywords/group clock, verified bidirectional public facts, private-event isolation, group-speaker boundaries and dynamic flags passed (fake DSH/QQ)');
}finally{if(app){app.stopReplyParts();await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();app.speech?.close?.();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
