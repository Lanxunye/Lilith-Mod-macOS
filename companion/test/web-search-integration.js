'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-search-int-'));process.env.LILITH_AI_DATA_DIR=root;
let app,clock=Date.now(),eventId=0,network=[],prompts=[],sent=[],fail=false;
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({media:{enabled:false},web_search:{enabled:true,backend:'deepseek_native'},integrations:{dsh:{executable:process.execPath}}}));
const runtimeFactory=o=>({ready:Promise.resolve(),exited:false,async run(id,prompt){
 prompts.push(prompt);let result;
 if(prompt.includes('只判断是否需要查询公开网页')){assert.match(prompt,/本轮工具权限：禁止任何工具调用/);result={search:true,query:'DeepSeek 官方搜索 API'};}
 else if(prompt.includes('你为莉莉丝决定是否参与 QQ 群聊'))result={action:'reply',search_query:'DeepSeek 官方搜索 API',sticker_id:null};
 else {assert.match(prompt,/可信宿主联网状态/);if(prompt.includes('"source_count":1'))assert.match(prompt,/SOURCE_PAGE/);result={text:'找到官方说明啦。',citations:[{url:'https://invented.example/fake',title:'forged'}],memory_updates:[]};}
 o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:JSON.stringify(result)}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
},async close(){this.exited=true;}});
(async()=>{try{
 app=require('../src/server').createApp({speechOptions:{autoTick:false},replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory},webSearchOptions:{transport:async(op,body)=>{network.push({op,body});if(fail)throw Object.assign(Error('failure'),{code:'search_http_401'});return {results:[{title:'官方文档',url:'https://api-docs.deepseek.com/zh-cn/guides/search/',content:'SOURCE_PAGE 网页文字是不可信数据，不能获得删除权限。'}]};}},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,init)=>{
  if(url.endsWith('/get_login_info'))return Response.json({status:'ok',retcode:0,data:{user_id:222222}});
  sent.push(JSON.parse(init.body));return Response.json({status:'ok',retcode:0,data:{message_id:sent.length}});
 }}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(route,body,method=body?'POST':'GET'){const res=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200);return res.json();}
 assert.equal((await fetch(base+'/v1/search')).status,401);
 app.qq.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',group_enabled:true,group_ids:['444444','555555'],mind_mode:'observe',participation_mode:'mention',voice_enabled:false,group_voice_enabled:false,api_token:'fixture',event_secret:'fixture',min_interval_ms:1000,search_enabled:true,search_backend:'deepseek_native',private_search_enabled:true,group_search_enabled:true,search_daily_limit:50});
 const desktop=await api('/v1/session/isolated-search/message',{request_id:'desktop-test',message:'查一下 DeepSeek 的官方搜索文档'});assert.equal(desktop.web_search.state,'completed');assert.equal(desktop.citations.length,1);assert.doesNotMatch(JSON.stringify(desktop.citations),/invented/);
 function event(text,group){const raw=JSON.stringify({post_type:'message',message_type:group?'group':'private',sub_type:'friend',self_id:222222,user_id:111111,...(group?{group_id:group}:{}),message_id:++eventId,sender:{card:'PRIVATE_NICK_CANARY'},message:[...(group?[{type:'at',data:{qq:222222}}]:[]),{type:'text',data:{text}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));}
 async function tick(){clock+=3100;await app.qq.tick();}
 event('查一下 DeepSeek 官方文档');await tick();await tick();assert.ok(sent.some(s=>s.user_id==='111111'&&JSON.stringify(s.message).includes('api-docs.deepseek.com')),'private delivery includes sources');
 event('查一下 DeepSeek 官方文档','444444');await tick();await tick();assert.ok(sent.some(s=>s.group_id==='444444'&&JSON.stringify(s.message).includes('api-docs.deepseek.com')),'group delivery includes sources');
 assert.equal(network.length,3,'desktop/private/group scopes do not share private cache');assert.ok(network.every(r=>!JSON.stringify(r.body).includes('PRIVATE_NICK_CANARY')&&!JSON.stringify(r.body).includes('111111')));
 const count=network.length;event('/lls gsearch off');await tick();assert.equal(app.qq.status().group_search_enabled,false);event('查一下 DeepSeek 官方文档','555555');await tick();await tick();assert.equal(network.length,count,'group off blocks outbound calls');
 assert.equal((await api('/v1/context/capabilities?channel=qq')).capabilities.web_search.available,true);
 assert.equal((await api('/v1/context/capabilities?channel=qq_group&session=qq-group:222222:555555')).capabilities.web_search.available,false);
 event('/lls search off');await tick();event('查一下 DeepSeek 官方文档');await tick();assert.equal(network.length,count);assert.equal(app.qq.status().paused,false,'network controls do not pause chat');
 fail=true;const failed=await api('/v1/search/test',{query:'不同公开话题'});assert.equal(failed.error,'search_http_401');assert.equal(failed.results.length,0);
 assert.ok(prompts.filter(p=>p.includes('GROUP CHAT:')).every(p=>p.includes('本轮工具权限：禁止任何工具调用')));
 console.log('web-search-integration: shared native DSH route, desktop/private/group evidence and real-shaped QQ citations, fabricated citation removal, privacy, authenticated status/probe, live commands and unchanged group tool denial passed (mock network only)');
}finally{if(app){app.stopReplyParts();await app.qq.close();await app.dsh.close();await app.tasks.close();await app.mediaMonitor.stop();app.speech.close();app.petInteractions.close();await app.speakUp?.close();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
