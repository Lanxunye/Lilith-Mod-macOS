'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-art-reply-'));process.env.LILITH_AI_DATA_DIR=root;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({mock_mode:false,provider:{api_key:'must-not-use'},integrations:{dsh:{executable:process.execPath},comfy:{enabled:true,base_url:'http://127.0.0.1:1',workflow:{'1':{class_type:'CLIPTextEncode',inputs:{text:''}}},prompt_node_id:'1',prompt_input:'text'}}}));
const {createApp}=require('../src/server');let app,submits=0,clock=Date.now(),id=0,runs=[],sends=[],hold=false,release,entered,fail=false;
const runtimeFactory=options=>({ready:Promise.resolve(),exited:false,async run(sessionId,prompt){
 runs.push({sessionId,prompt});
 if(prompt.includes('你是内部绘图场景编排器')){assert.match(prompt,/本轮工具权限：禁止任何工具调用/);assert.doesNotMatch(prompt,/GROUP_ONE_PRIVATE_CANARY/);options.onEvent('session.event',{sessionId,event:{type:'assistant/message',data:{content:JSON.stringify({scene:'Lilith rests in a peaceful garden, with a calm natural pose and soft evening light.',art_direction:require('../src/art-scene').fallbackDirection(),orientation:'square'})}}});options.onEvent('session.event',{sessionId,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});return;}
 const match=prompt.match(/"current_user_message":("(?:\\.|[^"\\])*")/),current=match?JSON.parse(match[1]):'';
 let text='慢慢说，我听着。';
 if(prompt.includes('本轮可信绘图状态：')){
  assert.match(prompt,/本轮工具权限：禁止任何工具调用/);assert.match(prompt,/"image_delivered":false/);assert.match(prompt,/不能声称已画好或已发送/);assert.match(prompt,/LILITH ORIGINAL STYLE/);
  assert.ok(current.length<=2000);const group=current.startsWith('[群成员 QQ ')?JSON.parse(current.slice(current.indexOf('\n')+1)):{text:current};assert.ok(group.text.includes('画一张'));
  text=group.text.includes('难过')?'那就让雨下在画里，留一点安静给你。':'庆功的画，当然得画得神气一点。';
  if(group.text.includes('庆祝'))assert.doesNotMatch(prompt,/GROUP_ONE_PRIVATE_CANARY/);
  if(hold){entered=true;await new Promise(r=>release=r);}
  if(fail)throw Object.assign(Error('synthetic failure'),{code:'dsh_rpc_error'});
 }
 options.onEvent('session.event',{sessionId,event:{type:'assistant/message',data:{content:JSON.stringify({text,emotion:'gentle',animation:'listen',memory_updates:[],art_action:{kind:'illustration',scene:'must not submit again'}})}}});
 options.onEvent('session.event',{sessionId,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
},async stop(){},async close(){this.exited=true;}});
const step=async(n=1)=>{for(let i=0;i<n;i++){clock+=3100;await app.qq.tick();}};
function group(text,group='444444'){const raw=JSON.stringify({post_type:'message',message_type:'group',self_id:222222,user_id:333333,group_id:group,message_id:++id,message:[{type:'at',data:{qq:222222}},{type:'text',data:{text}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
function command(text){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:++id,message:[{type:'text',data:{text}}]});return app.qq.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
(async()=>{try{
 app=createApp({replyPartsOptions:{autoTick:false},dshConversationOptions:{workspace:path.join(root,'workspace'),prepareProfile:()=>({profile:'fixture',env:{},status:{}}),runtimeFactory},artworkOptions:{reviewImage:async()=>({passed:true,issues:[]}),pollMs:1,integration:{submitImage:async()=>({job_id:'mock-'+ ++submits}),imageStatus:async()=>({status:'completed',images:[{filename:'mock.png',type:'output'}]})},fetch:async()=>new Response(png)},qqOptions:{autoTick:false,now:()=>new Date(clock),request:async(url,opts)=>{if(url.endsWith('/get_login_info'))return Response.json({status:'ok',retcode:0,data:{user_id:222222}});sends.push(JSON.parse(opts.body));return Response.json({status:'ok',retcode:0,data:{message_id:sends.length}});}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 app.qq.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'token',event_secret:'secret',group_enabled:true,group_ids:['444444','555555'],group_art_enabled:true,min_interval_ms:1000});
 // Large old scene records must not trap the bounded group-input builder.
 for(let n=0;n<3;n++)app.store.db.prepare("INSERT INTO qq_group_art_jobs VALUES (?,?,?,?,?,?,'sent',NULL,NULL,?,NULL,?)").run('old-'+n,'222222','111111','444444','qq-group:222222:444444',app.qq.status().group_art_day,'GROUP_ONE_PRIVATE_CANARY'+'旧画面'.repeat(450),clock-n);
 group('今天有点难过，画一张雨中的莉莉丝吧');await step();await app.artwork.wait(app.artwork.active);assert.equal(submits,1);await step(2);
 assert.equal(sends.filter(s=>s.message.some(m=>m.type==='image')).length,1);assert.ok(sends.some(s=>s.message.some(m=>m.type==='text'&&m.data.text.includes('让雨下在画里'))),JSON.stringify({texts:sends.flatMap(s=>s.message.filter(m=>m.type==='text').map(m=>m.data.text)),native_status:app.dsh.error,reasons:app.store.db.prepare('SELECT result FROM turns').all().map(r=>JSON.parse(r.result||'{}').fallback_reason),feedback_turns:runs.filter(r=>r.prompt.includes('本轮可信绘图状态：')).length}));
 assert.equal(app.store.recent('qq-group:222222:444444').filter(m=>m.role==='user').length,1,'semantic acknowledgement uses the real group journal once');
 group('终于赢了，画一张庆祝胜利的莉莉丝','555555');await step();await app.artwork.wait(app.artwork.active);await step(2);assert.equal(submits,2,'model art_action cannot resubmit drawing');assert.ok(sends.some(s=>s.group_id==='555555'&&s.message.some(m=>m.type==='text'&&m.data.text.includes('庆功的画'))));
 // A close command arriving during model generation suppresses the late acknowledgement.
 hold=true;entered=false;group('画一张莉莉丝看星星');clock+=3100;const pending=app.qq.tick();for(let n=0;n<200&&!entered;n++)await new Promise(r=>setTimeout(r,1));assert.equal(entered,true);const before=sends.length;command('/lls draw off');release();await pending;hold=false;if(app.artwork.active)await app.artwork.wait(app.artwork.active);await step(3);assert.ok(sends.slice(before).every(s=>!s.group_id),'no late acknowledgement or image after disabling');
 command('/lls draw on');await step();fail=true;group('画一张莉莉丝喝茶','555555');await step();await app.artwork.wait(app.artwork.active);await step(2);assert.ok(sends.some(s=>s.message.some(m=>m.type==='text'&&m.data.text==='这幅图让我慢慢画，稍等一下。')),'model failure keeps a truthful nontechnical fallback');assert.equal(submits,3,'disable during acknowledgement prevents submitting the cancelled image to Comfy');
 fail=false;app.qq.configure({private_art_enabled:true});
 const privateRaw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:111111,message_id:++id,message:[{type:'at',data:{qq:222222}},{type:'text',data:{text:'画一张庆祝胜利的莉莉丝'}}]});
 app.qq.accept(privateRaw,'sha1='+crypto.createHmac('sha1','secret').update(privateRaw).digest('hex'));await step();await app.artwork.wait(app.artwork.active);await step(2);
 assert.equal(submits,4);assert.ok(sends.some(s=>s.user_id==='111111'&&s.message.some(m=>m.type==='image')));assert.ok(runs.some(r=>r.prompt.includes('owner_private_explicit_at_or_prefix_and_drawing')),'native capability snapshot knows private drawing is available');
 const projection=JSON.parse(fs.readFileSync(path.join(root,'shared-chat-events.json')));assert.ok(projection.messages.some(m=>m.channel==='qq'&&m.content.includes('绘图已发送')),'confirmed private drawing updates the shared desktop journal');
 console.log('qq-group-art-reply: semantic group context and canon, no tools or duplicate render, bounded history, group isolation, durable journal, off-during-reply and truthful model failure fallback passed');
}finally{if(app){app.stopReplyParts();await app.qq.close();await app.dsh.close();await app.tasks.close();await app.mediaMonitor.stop();app.petInteractions.close();app.speech.close();await app.speakUp?.close();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
