import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createBridge, allowRequest} from './index.mjs';
const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-desktop-bridge-')),data=path.join(root,'data'),workspace=path.join(root,'workspace');fs.mkdirSync(data);fs.mkdirSync(workspace);
 const writeRuntime=(port=12345,token='local-test-auth-token-only')=>fs.writeFileSync(path.join(data,'runtime.json'),JSON.stringify({host:'127.0.0.1',port,token}));writeRuntime();
 const calls=[],rows=[{seq:1,id:'one',role:'user',channel:'qq',content:'测试原文',created_at:'2026-10-25T00:00:00Z'}];
 let failure=false,applied=new Set();
 const request=async(url,init)=>{
  calls.push({url,init});const p=new URL(url).pathname;let value;
  if(p==='/v1/qq')value={session_id:'desktop-pet',owner_qq:'not-exposed',bot_qq:'not-exposed'};
  else if(p==='/v1/dsh')value={running:true,active:false,status:'native_sdk_connected',purge:{status:'loaded_this_run'},pending:[]};
  else if(p.endsWith('/events')){const after=Number(new URL(url).searchParams.get('after')||0),page=rows.filter(r=>r.seq>after).slice(0,100);value={messages:page,cursor:page.at(-1)?.seq||after};}
  else if(p.endsWith('/message')){const b=JSON.parse(init.body);if(!applied.has(b.request_id)){applied.add(b.request_id);rows.push({seq:rows.length+1,id:'m-'+b.request_id,role:'user',content:b.message,channel:'desktop',created_at:'2026-10-25T00:00:01Z'});}if(failure){failure=false;throw Error('connection lost after commit');}value={status:'ok',text:'测试回复',conversation_engine:'dsh'};}
  else throw Error('unexpected endpoint');
  return {ok:true,json:async()=>value};
 };
 return {root,data,workspace,writeRuntime,calls,rows,failNext:()=>{failure=true;},bridge:createBridge({dataRoot:data,workspace,request}),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
};
test('owner private journal is shared in both directions and exported without runtime credentials',async()=>{
 const f=fixture();try{
  const before=await f.bridge.snapshot();assert.equal(before.messages[0].content,'测试原文');assert.equal(before.dsh.purge_loaded,true);
  assert.doesNotMatch(JSON.stringify(before),/local-test-auth-token-only|not-exposed/);
  await assert.rejects(f.bridge.send({message:'你好',request_id:'r1'},'wrong'),e=>e.code==='lilith_csrf_invalid');
  await assert.rejects(f.bridge.send({message:'你好',request_id:'r1'},'龙'.repeat(64)),e=>e.code==='lilith_csrf_invalid');
  const after=await f.bridge.send({message:'从DSH续聊',request_id:'r1'},before.csrf);assert.equal(after.result.conversation_engine,'dsh');assert.equal(after.snapshot.messages.at(-1).content,'从DSH续聊');
  assert.ok(f.calls.some(r=>r.url.endsWith('/v1/session/desktop-pet/message')));assert.ok(f.calls.every(r=>r.init.redirect==='error'));
  assert.equal(JSON.parse(f.calls.find(r=>r.url.endsWith('/message')).init.body).request_id,'dsh-desktop:r1');
  const file=after.snapshot.transcript_file;assert.equal(fs.statSync(file).mode&0o777,0o600);assert.match(fs.readFileSync(file,'utf8'),/从DSH续聊/);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/local-test-auth-token-only|not-exposed/);
  f.writeRuntime(12346,'rotated-local-test-auth');await f.bridge.snapshot(1);assert.equal(f.calls.at(-1).init.headers.Authorization,'Bearer rotated-local-test-auth');
 }finally{f.cleanup();}
});
test('lost response retains idempotency and does not create a second message',async()=>{
 const f=fixture();try{const s=await f.bridge.snapshot();f.failNext();const body={message:'同一个请求',request_id:'retry1'};
 await assert.rejects(f.bridge.send(body,s.csrf));await f.bridge.send(body,s.csrf);assert.equal(f.rows.filter(r=>r.content===body.message).length,1);
 }finally{f.cleanup();}
});
test('paginates the canonical event API beyond its first 100 records, including new replies',async()=>{
 const f=fixture();try{
  for(let seq=2;seq<=205;seq++)f.rows.push({seq,id:'row-'+seq,role:'assistant',channel:'desktop',content:'分页测试 '+seq,created_at:'2026-10-25T00:00:00Z'});
  const s=await f.bridge.snapshot();assert.equal(s.messages.length,205);assert.equal(s.cursor,205);
  const r=await f.bridge.send({message:'最后一条续聊',request_id:'last'},s.csrf);assert.equal(r.snapshot.messages.at(-1).content,'最后一条续聊');
  assert.equal(fs.readFileSync(s.transcript_file,'utf8').trim().split('\n').length,206);
 }finally{f.cleanup();}
});
test('external edits, foreign directories and symlinks stop projection without damaging history',async()=>{
 for(const mode of ['edited','foreign','symlink']){
  const f=fixture();try{
   const dir=path.join(f.workspace,'莉莉丝对话同步'),file=path.join(dir,'对话记录.jsonl');
   if(mode==='foreign'){fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'user.txt'),'keep');}
   else {await f.bridge.snapshot();fs.writeFileSync(file,'manual edit');if(mode==='symlink'){fs.renameSync(file,path.join(f.root,'user.txt'));fs.symlinkSync(path.join(f.root,'user.txt'),file);}}
   const s=await f.bridge.snapshot();assert.match(s.projection_error,/lilith_sync_/);assert.equal(s.messages[0].content,'测试原文');
   if(mode==='foreign')assert.equal(fs.readFileSync(path.join(dir,'user.txt'),'utf8'),'keep');else assert.equal(fs.readFileSync(file,'utf8'),'manual edit');
  }finally{f.cleanup();}
 }
});
test('recovers an interrupted projection publication without treating it as an external edit',async()=>{
 const f=fixture();try{
  const s=await f.bridge.snapshot(),markerFile=path.join(path.dirname(s.transcript_file),'.lilith-sync.json');
  const marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));
  marker.next_sha256=crypto.createHash('sha256').update(fs.readFileSync(s.transcript_file)).digest('hex');marker.sha256='previous-commit';
  fs.writeFileSync(markerFile,JSON.stringify(marker));
  assert.equal((await f.bridge.snapshot()).projection_error,'');assert.equal(JSON.parse(fs.readFileSync(markerFile,'utf8')).next_sha256,undefined);
 }finally{f.cleanup();}
});
test('loopback/same-origin checks block network peers, DNS rebinding and cross-site writes',()=>{
 const req=(host='127.0.0.1:43120',origin='http://127.0.0.1:43120',remoteAddress='127.0.0.1',site='same-origin')=>({headers:{host,origin,'sec-fetch-site':site},socket:{remoteAddress}});
 assert.equal(allowRequest(req()),true);assert.equal(allowRequest(req('attacker.example:43120','http://attacker.example:43120')),false);
 assert.equal(allowRequest(req(undefined,'https://evil.example')),false);assert.equal(allowRequest(req(undefined,'null')),false);
 assert.equal(allowRequest(req(undefined,undefined,'192.0.2.1')),false);assert.equal(allowRequest(req(undefined,undefined,undefined,'cross-site')),false);
});
