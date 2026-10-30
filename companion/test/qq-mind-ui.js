'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-mind-ui-'));process.env.LILITH_AI_DATA_DIR=root;
(async()=>{
 const {createApp}=require('../src/server');let network=0;
 const app=createApp({chatEngine:'provider-test',qqOptions:{autoTick:false,request:async()=>{network++;throw Error('Unexpected network request');}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const api=async(method,route,body,auth=true)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+app.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  for(const [method,route,body] of [['GET','/v1/qq/mind'],['POST','/v1/qq/mind/preview',{}],['POST','/v1/qq/mind/member',{}]])assert.equal((await api(method,route,body,false)).status,401);
  assert.equal((await api('PATCH','/v1/qq',{owner_qq:'111111',bot_qq:'222222',group_ids:['444444'],collection_only:true})).status,200);
  assert.equal((await api('PATCH','/v1/qq',{mind_mode:'not-a-mode'})).status,400);
  assert.equal((await api('GET','/v1/qq/mind')).body.mode,'observe');
  const control=await api('POST','/v1/qq/mind/member',{scope:'group:444444',member:'333333',action:'quiet'});assert.equal(control.status,200);assert.equal(control.body.relation.tier,'reserved');
  assert.equal((await api('POST','/v1/qq/mind/member',{scope:'group:999999',member:'333333',action:'quiet'})).status,400);
  const preview=await api('POST','/v1/qq/mind/preview',{scope:'group:444444',member:'333333',text:'谢谢你',force:true,proposal:{action:'reply'}});
  assert.equal(preview.status,200);assert.equal(preview.body.preview_only,true);assert.equal(preview.body.persisted,false);assert.equal(preview.body.sends,0);assert.equal(preview.body.effective.action,'skip');assert.ok(preview.body.gates.includes('collection_only'));
  assert.equal((await api('POST','/v1/qq/mind/preview',{scope:'group:444444',member:'333333',text:'a'.repeat(2001)})).status,400);
  const state=(await api('GET','/v1/qq')).body;assert.equal(state.paused,true);assert.equal(state.collection_only,true);assert.equal(state.mind_mode,'observe');assert.equal(network,0);assert.equal(state.outbox.length,0);
  const page=await(await fetch(base+'/ui/qq')).text(),js=await(await fetch(base+'/ui/app.js')).text();assert.match(page,/qq-mind-preview-form/);assert.match(page,/仅预演，不发送/);assert.match(js,/mind_mode/);assert.match(js,/\/v1\/qq\/mind\/preview/);
  console.log('qq-mind-ui: authenticated control/preview endpoints, scope validation, bounded input, no network/send and paused collection-only invariants passed.');
 }finally{await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
