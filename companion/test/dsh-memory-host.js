'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ConversationStore}=require('../src/conversation-store'),{MemoryStore,MEMORY_OFF_CONTRACT}=require('../src/dsh-memory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-memory-host-'));process.env.LILITH_AI_DATA_DIR=root;
let app;const prompts=[];
(async()=>{try{
 const old=new ConversationStore(root),session='desktop-pet';
 old.begin(session,'old',{message:'我喜欢CANARY_LEMON'});old.commit(session,'old','我喜欢CANARY_LEMON',{text:'旧回应'},'desktop','fixture',null,
  {updates:[{key:'favorite_drink',value:'CANARY_LEMON',evidence:'我喜欢CANARY_LEMON'}],sensitive:()=>false});
 const pair=old.recent(session);old.saveSummary(session,pair,[{source_id:pair[0].id,quote:pair[0].content}]);
 for(let n=0;n<30;n++){old.begin(session,'recent'+n,{message:'最近的普通对话'+n});old.commit(session,'recent'+n,'最近的普通对话'+n,{text:'普通回应'},'desktop','fixture');}
 const count=old.messages(session,0,500).length;old.close();
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({mock_mode:false,media:{enabled:false},integrations:{dsh:{executable:process.execPath}}}));
 const pkg=path.join(root,'dsh-lilith/home/profiles/lilith/node_modules/dsh-fish-memory');fs.mkdirSync(pkg,{recursive:true});
 fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
 const {createApp}=require('../src/server');
 app=createApp({dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{memory:{installed:true}}}),
  runtimeFactory:o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){prompts.push(prompt);
   o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify({text:'嗯，先聊眼前这件事。',memory_updates:[]})}}});
   o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});},async close(){this.exited=true;}})},qqOptions:{autoTick:false}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 assert.equal((await fetch(base+'/v1/dsh/memory')).status,401);
 let r=await api('/v1/dsh/memory');assert.ok(r.data.total>=1,'old source-backed memory migrated');
 const index=new MemoryStore(path.join(root,'dsh-lilith/home'));assert.ok(index.load().legacy_imported);
 await api('/v1/session/desktop-pet/message',{request_id:'new',message:'今天聊点别的吧。'});
 assert.equal(prompts.length,1,'no second summarizer/model call');assert.match(prompts[0],/memory_events/);
 assert.doesNotMatch(prompts[0],/CANARY_LEMON/,'old facts and summaries are not injected twice');
 assert.equal((await api('/v1/dsh/memory',{enabled:false},'PATCH')).status,200);
 assert.equal((await api('/v1/dsh/memory',{unexpected:1},'PATCH')).status,400);
 await api('/v1/session/desktop-pet/message',{request_id:'off',message:'先别记东西。'});
 assert.ok(prompts.at(-1).includes(MEMORY_OFF_CONTRACT));assert.doesNotMatch(prompts.at(-1),/CANARY_LEMON/,'disabled memory cannot fall back to old injection');
 await api('/v1/control',{action:'reset_session',session_id:session});assert.ok(index.load().memories.length,'reset recent chat retains long-term memory');
 await api('/v1/control',{action:'forget_player',player_name:'主人'});assert.equal(index.load().memories.length,0);assert.equal(index.load().legacy_imported,true);
 const db=new (require('node:sqlite').DatabaseSync)(path.join(root,'conversations.sqlite'),{readOnly:true});
 assert.ok(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n>=count);db.close();
 console.log('dsh-memory-host: authenticated controls, source migration, no duplicate injection, no extra summarizer, disable, reset and forget contracts passed');
}finally{if(app){await app.dsh.close();await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
