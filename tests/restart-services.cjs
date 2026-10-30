'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {restart}=require('../scripts/restart-services.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-restart-'));
const fixture={host:'127.0.0.1',port:54321,pid:4242,lifecycle:'standalone',token:'fixture-local-auth'};
function scenario(state=fixture,responses={}){
 const data=fs.mkdtempSync(path.join(root,'case-'));if(state)fs.writeFileSync(path.join(data,'runtime.json'),JSON.stringify(state));
 const signals=[],calls=[],starts=[];let dead=false;
 const options={data,support:'/fixture/scripts',node:'/fixture/node',sleep:async()=>{},
  signal:(pid,sig)=>{assert.equal(pid,4242);signals.push(sig);if(dead){const e=Error('gone');e.code='ESRCH';throw e;}if(sig==='SIGTERM')dead=true;},
  request:async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+fixture.token);calls.push(new URL(url).pathname);return {ok:true,json:async()=>responses[new URL(url).pathname]||{}};},
  run:(node,args,config)=>{starts.push({node,args});assert.equal(config.env.LILITH_AI_DATA_DIR,data);}};
 return {options,signals,calls,starts,data};
}
(async()=>{
 try{
  for(const [route,body]of [['/v1/dsh',{active:true}],['/v1/dsh',{pending:[{}]}],['/v1/qq',{pending:1}],['/v1/qq',{group_art_pending:1}],['/v1/qq',{private_art_pending:1}],['/v1/qq',{qq_voice_pending:1}],['/v1/qq',{outbox:[{state:'sending'}]}],['/v1/dsh/reply-parts',{pending:1}]]){
   const s=scenario(fixture,{[route]:body});await assert.rejects(restart(s.options),/正在回复或发送/);assert.ok(!s.signals.includes('SIGTERM'));assert.equal(s.starts.length,0);
  }
  const auth=scenario();auth.options.request=async()=>({ok:false});await assert.rejects(restart(auth.options),/身份检查失败/);assert.ok(!auth.signals.includes('SIGTERM'));assert.equal(auth.starts.length,0);
  for(const change of [{host:'example.org'},{lifecycle:'game'},{pid:0},{port:0},{token:null}]){const s=scenario({...fixture,...change});await assert.rejects(restart(s.options),/不是可安全重启/);assert.deepEqual(s.signals,[]);assert.equal(s.starts.length,0);}
  for(const [route,body]of [['/v1/art/jobs',{jobs:[{status:'running'}]}],['/v1/bili',{busy:true}],['/v1/speech',{queued:1}],['/v1/speech',{status:'playing'}]]){const s=scenario(fixture,{[route]:body});await assert.rejects(restart(s.options),/正在回复或发送/);assert.ok(!s.signals.includes('SIGTERM'));assert.equal(s.starts.length,0);}
  const idle=scenario();await restart(idle.options);assert.deepEqual(idle.signals,[0,'SIGTERM',0]);assert.equal(idle.starts.length,1);assert.equal(idle.calls.length,6);
  const missing=scenario(null);await restart(missing.options);assert.deepEqual(missing.signals,[]);assert.equal(missing.starts.length,1);
  const stubborn=scenario();stubborn.options.signal=(pid,sig)=>{assert.equal(pid,4242);stubborn.signals.push(sig);};await assert.rejects(restart(stubborn.options),/尚未退出/);assert.equal(stubborn.starts.length,0);assert.ok(!stubborn.signals.includes('SIGKILL'));
  console.log('restart-services: busy/auth/invalid owner rejection, graceful shutdown, absent service start and no forced kill passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
