'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lilith-mac-api-'));
process.env.LILITH_AI_DATA_DIR = root;
process.env.LILITH_AI_CONFIG = path.join(root, 'config.json');
fs.writeFileSync(process.env.LILITH_AI_CONFIG, JSON.stringify({mock_mode:true,media:{enabled:false},
  provider:{api_key:'test-local-secret'}, integrations:{dsh:{enabled:false},comfy:{enabled:false}}}));
const { createApp } = require('../src/server');
const { readMedia } = require('../src/media-macos');
const { createPlayerNameBridge } = require('../src/player-name');

(async()=>{
  let submitted, bridgeMessages, plannerPrompt, responseFormat;
  const fake = http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    res.setHeader('Content-Type','application/json');
    if(req.url==='/prompt'){submitted=JSON.parse(text);res.end(JSON.stringify({prompt_id:'job-1',number:1}));}
    else if(req.url==='/history/job-1')res.end(JSON.stringify({'job-1':{status:{status_str:'success'},outputs:{'9':{images:[{filename:'test.png',type:'output',subfolder:''}]}}}}));
    else if(req.url==='/agent'){bridgeMessages=JSON.parse(text);res.end(JSON.stringify({text:'bridge test reply'}));}
    else if(req.url==='/v1/chat/completions'){const payload=JSON.parse(text);assert.ok(payload.messages.every(m=>Object.keys(m).every(k=>['role','content'].includes(k))),'UI timestamps and sticker fields must not leak into provider message schema');plannerPrompt=payload.messages[0].content;responseFormat=payload.response_format;res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'我想画一个小小的鼓励送给你。',emotion:'happy',animation:'smile',memory_updates:[],art_action:{kind:'sticker',scene:'莉莉丝轻轻点头鼓励',caption:'慢慢来',mood:'gentle'}})}}]}));}
    else if(req.url.startsWith('/view?')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7gAAAABJRU5ErkJggg==','base64'));}
    else {res.statusCode=404;res.end('{}');}
  });
  await new Promise(r=>fake.listen(0,'127.0.0.1',r));
  const app=createApp({chatEngine:'provider-test'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function call(route,method='GET',body,auth=true){const r=await fetch(base+route,{method,
    headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${app.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};}
  try{
    assert.equal((await call('/v1/settings','GET',undefined,false)).status,401);
    assert.equal((await call('/v1/art/jobs','GET',undefined,false)).status,401);
    const page=await fetch(base+'/ui/settings');assert.equal(page.status,200);assert.ok((page.headers.get('content-security-policy')||'').includes("frame-ancestors 'none'"));
    assert.ok(!(await page.text()).includes('test-local-secret'));
    const settings=await call('/v1/settings');assert.equal(settings.status,200);assert.equal(settings.body.config.provider.api_key,undefined);assert.equal(settings.body.config.provider.api_key_configured,true);
    assert.equal((await call('/v1/settings','PATCH',{listen_host:'0.0.0.0'})).status,400);
    assert.equal((await call('/v1/settings','PATCH',{integrations:{comfy:{enabled:'false'}}})).status,400);
    assert.equal((await call('/v1/settings','PATCH',{media:{enabled:'true'}})).status,400);
    assert.equal((await call('/v1/settings','PATCH',{provider:{model:'test-model',api_key:''}})).status,200);
    assert.equal(JSON.parse(fs.readFileSync(process.env.LILITH_AI_CONFIG)).provider.api_key,'test-local-secret');
    assert.equal((await call('/v1/integrations/comfy/jobs','POST',{prompt:'test'})).status,409);
    const url=`http://127.0.0.1:${fake.address().port}`;
    const workflow={'6':{class_type:'CLIPTextEncode',inputs:{text:'original',clip:['1',0]}}};
    assert.equal((await call('/v1/settings','PATCH',{integrations:{comfy:{enabled:true,base_url:url,workflow,prompt_node_id:'6',prompt_input:'text'},dsh:{enabled:true,endpoint:url+'/agent'}}})).status,200);
    const job=await call('/v1/integrations/comfy/jobs','POST',{prompt:'a local Qwen workflow test'});
    assert.equal(job.status,202);assert.equal(submitted.prompt['6'].inputs.text,'a local Qwen workflow test');assert.equal(workflow['6'].inputs.text,'original');
    const status=await call('/v1/integrations/comfy/jobs/job-1');assert.equal(status.body.status,'completed');assert.equal(status.body.images[0].filename,'test.png');
    assert.equal((await call('/v1/integrations/comfy/jobs','POST',{workflow:{nodes:[]}})).status,400);
    const bridge=await call('/v1/integrations/dsh/chat','POST',{messages:[{role:'user',content:'test'}]});
    assert.equal(bridge.status,200);assert.equal(bridge.body.text,'bridge test reply');assert.equal(bridgeMessages.protocol_version,1);
    assert.equal((await call('/v1/player-memory','PUT',{facts:[{key:'喜欢的颜色',value:'红色'}]})).status,200);
    assert.equal((await call('/v1/player-memory')).body.facts[0].value,'红色');
    assert.equal((await call('/v1/player-name','POST',{operation:'apply',name:'测试'})).status,400);
    const state={running:true,session_id:'isolated-test',player_name:'旧名',updated_at:new Date().toISOString()};
    let migrated;
    const rename=createPlayerNameBridge(root,{gameState:()=>state,migrateMemory:(...args)=>migrated=args});
    const pending=rename({operation:'apply',name:'新名'});
    const request=JSON.parse(fs.readFileSync(path.join(root,'player-name-request.json')));
    fs.writeFileSync(path.join(root,'player-name-result.json'),JSON.stringify({request_id:request.request_id,
      session_id:state.session_id,success:true,changed:true,old_name:'旧名',applied_name:'新名'}));
    assert.equal((await pending).applied_name,'新名');assert.deepEqual(migrated,['旧名','新名']);
    assert.equal(fs.existsSync(path.join(root,'player-name-request.json')),false);
    const media=await readMedia(async()=>({stdout:JSON.stringify({available:true,playing:true,source:'spotify',title:'测试曲'})}));
    assert.equal(media.title,'测试曲');
    assert.equal((await readMedia(async()=>{throw {stderr:'not authorized -1743'};})).error,'automation_permission_required');
    assert.equal((await call('/v1/settings','PATCH',{mock_mode:false,provider:{base_url:url+'/v1',model:'local-fake',kind:'deepseek'},
      integrations:{comfy:{autonomous_enabled:true}}})).status,200);
    const draw=await call('/v1/session/desktop-pet/message','POST',{message:'给我画一个鼓励的表情包',player:{name:'测试'},request_id:'drawing-contract'});
    assert.equal(draw.status,200);assert.equal(draw.body.status,'ok');assert.ok(draw.body.drawing.id);
    assert.match(plannerPrompt,/Local drawing is available/);assert.equal(responseFormat.type,'json_object');await app.artwork.wait(draw.body.drawing.id);
    const drawn=await call('/v1/art/jobs/'+draw.body.drawing.id);assert.equal(drawn.body.status,'completed');assert.equal(drawn.body.caption,'慢慢来');
    assert.equal(drawn.body.delivery,'chat_sticker');
    const image=await fetch(base+drawn.body.image_path,{headers:{Authorization:`Bearer ${app.token}`}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
    assert.equal((await fetch(base+drawn.body.image_path)).status,401);
    const history=await call('/v1/session/desktop-pet/history');
    assert.equal(history.body.messages.at(-1).sticker.id,draw.body.drawing.id);
    for(let turn=2;turn<=3;turn++){
      const blocked=await call('/v1/session/desktop-pet/message','POST',{message:'继续聊聊今天吧',player:{name:'测试'},request_id:'chat-turn-'+turn});
      assert.equal(blocked.body.drawing.reason,'art_chat_turn_limit');
      assert.match(plannerPrompt,/Chat sticker permitted this turn: NO/);
    }
    const eligible=await call('/v1/session/desktop-pet/message','POST',{message:'听到你这么说，我开心多了',player:{name:'测试'},request_id:'chat-turn-4'});
    assert.ok(eligible.body.drawing.id);await app.artwork.wait(eligible.body.drawing.id);
    assert.match(plannerPrompt,/Chat sticker permitted this turn: yes/);
    assert.equal((await call('/v1/session/desktop-pet/history')).body.messages.filter(m=>m.sticker).length,2);
    await call('/v1/control','POST',{action:'reset_session',session_id:'desktop-pet'});
    assert.equal((await call('/v1/session/desktop-pet/history')).body.messages.length,0);
    console.log('mac-api: settings auth, secret preservation, memory, DSH bridge and Comfy job contracts passed (local fake servers only).');
  }finally{
    await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));await new Promise(r=>fake.close(r));fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
