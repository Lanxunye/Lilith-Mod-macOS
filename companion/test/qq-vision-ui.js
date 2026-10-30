'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-vision-ui-'));process.env.LILITH_AI_DATA_DIR=root;
(async()=>{
 const {createApp}=require('../src/server');let visualCalls=0;
 const app=createApp({chatEngine:'provider-test',qqOptions:{autoTick:false,capabilitiesOptions:{requestJson:async()=>{visualCalls++;return {choices:[{message:{content:'{"description":"红蓝色块","is_sticker":false}'}}]};}}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(method,route,body,auth=true){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+app.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 try{
  assert.equal((await api('POST','/v1/qq/vision/probe',{},false)).status,401);
  const page=await (await fetch(base+'/ui/qq')).text();assert.match(page,/qq-vision-probe/);const js=await(await fetch(base+'/ui/app.js')).text();assert.match(js,/vision_api_key/);
  const result=await api('PATCH','/v1/qq',{vision_enabled:true,vision_api_key:'fixture-visual-secret',vision_base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',vision_model:'qwen3-vl-plus'});
  assert.equal(result.status,200);assert.equal(result.body.group_daily_limit,100);assert.equal(result.body.group_round_limit,null);assert.equal(result.body.enabled,false);assert.equal(result.body.paused,true);assert.equal(result.body.vision_api_key_configured,true);assert.ok(Array.isArray(result.body.media_roots));assert.doesNotMatch(JSON.stringify(result.body),/fixture-visual-secret/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'qq.json'),'utf8')).vision_api_key,'fixture-visual-secret');
  assert.equal((await api('POST','/v1/qq/vision/probe',{})).body.ok,true);assert.equal(visualCalls,1);
  const liveState=(await api('GET','/v1/qq')).body;assert.equal(liveState.vision_status,'verified_this_run');assert.equal(typeof liveState.local_build,'string');
  assert.equal((await api('POST','/v1/qq/voice/synthesize',{text:'你好'})).status,400);
  console.log('qq-vision-ui: authenticated settings/save/probe, beta console controls, redacted key, paused QQ, 100/day and no round cap passed.');
 }finally{await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
