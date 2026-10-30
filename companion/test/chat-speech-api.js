'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-speech-api-'));
process.env.LILITH_AI_DATA_DIR=root;process.env.LILITH_AI_CONFIG=path.join(root,'config.json');
fs.writeFileSync(process.env.LILITH_AI_CONFIG,JSON.stringify({mock_mode:true,media:{enabled:false}}));
const {createApp}=require('../src/server');
(async()=>{
 const app=createApp({chatEngine:'provider-test',speechOptions:{autoTick:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function api(method,route,body,auth=true){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+app.token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 try{
  assert.equal((await api('PATCH','/v1/speech',{enabled:true},false)).status,401);
  assert.equal((await api('GET','/v1/speech')).data.enabled,false);
  assert.equal((await api('POST','/v1/speech/test',{text:'测试'})).status,409);
  assert.equal((await api('PATCH','/v1/speech',{enabled:'yes'})).status,400);
  assert.equal((await api('PATCH','/v1/speech',{enabled:true,url:'https://example.com'})).status,400);
  assert.equal((await api('PATCH','/v1/speech',{enabled:true})).data.enabled,true);
  assert.equal((await api('POST','/v1/speech/stop',{})).data.enabled,true);
  assert.equal((await api('PATCH','/v1/speech',{enabled:false})).data.enabled,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'speech-settings.json'))).enabled,false);
  console.log('chat-speech-api: authentication, typed toggle, endpoint isolation and stop semantics passed');
 }finally{await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
