'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const {officialRequest,installSearch}=await import('../src/dsh-search.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-native-search-')),file=path.join(root,'endpoint.json'),token='fixture-secret-for-native-search-bridge',calls=[];let instance;
 const credentials={resolve:async ref=>{assert.equal(ref,'DEEPSEEK_API_KEY');return {value:'sk-fixture-never-return'};}};
 const request=async(url,opts)=>{calls.push({url,opts});assert.equal(url,'https://api.deepseek.com/v1/tools/search');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer sk-fixture-never-return');assert.deepEqual(JSON.parse(opts.body),{query:'DeepSeek',count:5,need_content:true});return Response.json({results:[]});};
 try{
  await assert.rejects(officialRequest(credentials,'DEEPSEEK_API_KEY','shell',{}),/operation_denied/);
  await assert.rejects(officialRequest({resolve:async()=>({value:'account-grant-not-api-key'})},'DEEPSEEK_API_KEY','search',{query:'x',count:5}),/api_key_required/);
  await assert.rejects(officialRequest(credentials,'DEEPSEEK_API_KEY','search',{query:'x'.repeat(129),count:5}),/invalid_query/);
  await assert.rejects(officialRequest(credentials,'DEEPSEEK_API_KEY','search',{query:'x',count:5},{request:async()=>new Response('secret upstream diagnostic',{status:401})}),e=>e.code==='search_http_401'&&!e.message.includes('secret'));
  const ready=[];instance=await installSearch({credentials,provide:(key,v)=>ready.push(key),effect:()=>{}},{file,token,request});
  assert.deepEqual(ready,['lilithSearchReady']);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fixture-secret|sk-fixture/);
  const endpoint='http://127.0.0.1:'+JSON.parse(fs.readFileSync(file)).port+'/search';
  assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,403);assert.equal(calls.length,0);
  const result=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({operation:'search',payload:{query:'DeepSeek',count:5,localization:'private-ip-must-not-pass',ori_question:'private chat must not pass'}})});
  assert.deepEqual(await result.json(),{value:{results:[]}});assert.equal(calls.length,1);
  console.log('dsh-search: native credential reference, no account-token reuse/key export, fixed official origin, no redirects/private payload, authenticated loopback IPC and bounded HTTP errors passed');
 }finally{instance?.dispose();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
