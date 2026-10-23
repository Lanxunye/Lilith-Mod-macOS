'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{execFile}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-service-'));
const script=path.resolve(__dirname,'../../scripts/companion-service.cjs');
const env={...process.env,LILITH_AI_DATA_DIR:root,LILITH_AI_CONFIG:path.join(root,'config.json'),LILITH_GAME_PID:'2147483647'};
function command(action){return new Promise((resolve,reject)=>execFile(process.execPath,[script,action],{env},(e,stdout,stderr)=>e?reject(Error(stderr||e.message)):resolve(stdout)));}
(async()=>{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 fs.writeFileSync(env.LILITH_AI_CONFIG,JSON.stringify({mock_mode:true,listen_port:port,media:{enabled:false}}));
 let pid;
 try{
  await command('start');const runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime.json')));pid=runtime.pid;
  const {reusableService}=require('../../scripts/launch-installed-macos.cjs');
  assert.equal(await reusableService(root,{listen_port:port}),true);
  assert.equal(await reusableService(root,{listen_port:port+1}),false);
  assert.equal(runtime.lifecycle,'standalone');assert.equal(runtime.game_pid,undefined);
  await new Promise(r=>setTimeout(r,1200));assert.doesNotThrow(()=>process.kill(pid,0),'standalone must ignore inherited stale game pid');
  await command('start');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'runtime.json'))).pid,pid);
  assert.match(await command('status'),/standalone/);
  await command('stop');for(let i=0;i<40&&fs.existsSync(path.join(root,'runtime.json'));i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(fs.existsSync(path.join(root,'runtime.json')),false);
  assert.equal(fs.existsSync(path.join(root,'companion.lock')),false);
  console.log('companion-service: detached lifecycle survives absent game, authenticated reuse, single process and owned shutdown passed.');
 }finally{if(pid)try{process.kill(pid,'SIGTERM');}catch{}fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
