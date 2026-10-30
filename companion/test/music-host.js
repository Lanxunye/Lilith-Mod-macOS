'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-music-host-'));process.env.LILITH_AI_DATA_DIR=root;
const prompts=[],sent=[];let app,clock=Date.now(),id=0;
(async()=>{try{
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({media:{enabled:false},integrations:{dsh:{executable:process.execPath}}}));

 app=require('../src/server').createApp({speechOptions:{autoTick:false},replyPartsOptions:{autoTick:false},musicOptions:{autoTick:false,source:{snapshot:async()=>({running:true,available:true,playing:true,id:'12345',title:'MUSIC_PRIVATE_CANARY',artist:'公开艺人',playback_status:'playing'}),song:()=>({id:'12345',title:'MUSIC_PRIVATE_CANARY',artists:['公开艺人']}),playlist:()=>({id:'8781548197',name:'浔野的小歌单',tracks:[],total:0,metadata_count:0,complete:true}),publicRead:async()=>({state:'read',text:'测试歌词'}),audio:()=>null},audio:async()=>({state:'unavailable'}),worker:{complete:async()=>({summary:'MUSIC_PRIVATE_CANARY',thought:'想了解这首歌。',stance:'curious',reason:'歌词里的转折。'}),async stop(){},async close(){}}},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory:o=>({ready:Promise.resolve(),exited:false,openedSessions:new Set(),async run(id,prompt){
  this.openedSessions.add(id);if(prompt.includes('LILITH HOST CAPABILITIES'))prompts.push(prompt);
  const response=!prompt.includes('LILITH HOST CAPABILITIES')?{action:'reply'}:{messages:[{text:'莉莉丝记住了，会慢慢和你聊。'}],memory_updates:[]};
  o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify(response)}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 },async close(){this.exited=true;}})},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};sent.push(JSON.parse(init.body));return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:sent.length}})};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 app.qq.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',group_enabled:true,group_ids:['444444'],participation_mode:'mention',voice_enabled:false,group_voice_enabled:false,api_url:'http://127.0.0.1:1',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000});
 assert.equal((await fetch(base+'/v1/music')).status,401);assert.equal((await fetch(base+'/v1/music/records')).status,401);
 await api('/v1/music',{enabled:true,automatic:false},'PATCH');await api('/v1/music/sync',{});
 const run=await api('/v1/music/run',{kind:'current',request_id:'fixture-reader'});assert.equal(run.status,202);
 while(app.music.busy)await new Promise(r=>setTimeout(r,1));assert.equal((await api('/v1/music/records')).data.interests.length,1);
 function event(group,text){const payload={post_type:'message',message_type:group?'group':'private',sub_type:group?'normal':'friend',self_id:222222,user_id:111111,...(group?{group_id:444444}:{}),message_id:++id,sender:{nickname:'主人'},message:[...(group?[{type:'at',data:{qq:222222}}]:[]),{type:'text',data:{text}}]};const raw=JSON.stringify(payload);const accepted=app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));assert.equal(accepted.accepted,true,JSON.stringify(accepted));}
 const desktop=await api('/v1/session/desktop-pet/message',{request_id:'fixture-desktop',message:'你最近喜欢什么歌？'});assert.equal(desktop.status,200);assert.match(prompts.at(-1),/MUSIC_PRIVATE_CANARY/);
 event(false,'你最近喜欢什么歌？');clock+=4000;await app.qq.tick();assert.match(prompts.at(-1),/MUSIC_PRIVATE_CANARY/);assert.match(prompts.at(-1),/LILITH PRIVATE MUSIC/);
 const before=app.music.usage();event(true,'主人现在在听什么歌？');clock+=4000;await app.qq.tick();assert.doesNotMatch(prompts.at(-1),/MUSIC_PRIVATE_CANARY|LILITH PRIVATE MUSIC|浔野的小歌单/);assert.deepEqual(app.music.usage(),before);
 const snap=await api('/v1/context/capabilities?channel=qq_group&session=qq-group:222222:444444');assert.equal(snap.data.capabilities.music_reading.available,false);assert.ok(!JSON.stringify(snap.data).includes('浔野的小歌单'));
 event(false,'分析这首歌');clock+=4000;await app.qq.tick();assert.match(prompts.at(-1),/禁止任何工具调用/);assert.match(prompts.at(-1),/queued/);
 const current=await api('/v1/music/refresh',{});assert.equal(current.data.current.id,'12345');
 assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user' AND content LIKE '%MUSIC_PRIVATE_CANARY%'").get().n,0);
 console.log('music-host: authenticated APIs, owner-private recall, group privacy including owner, capability gating, trusted background request and no forged messages passed (fake SDK/QQ)');
}finally{if(app){await app.music.close();app.stopReplyParts();await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();app.speech.close();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
