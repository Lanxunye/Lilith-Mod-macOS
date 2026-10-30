'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {ensureServices,localURL}=require('../../scripts/startup-services.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-startup-test-')),servers=[],spawns=[];
let dsh=false,loggedIn=true,enabled=true,paused=true,starts=0;
const listen=(server,port=0)=>new Promise(r=>server.listen(port,'127.0.0.1',()=>r(server.address().port)));
async function freePort(){const s=http.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p;}
const close=server=>new Promise(r=>server.close(r));
const send=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
(async()=>{
 const companionPort=await freePort(),qqPort=await freePort(),comfyPort=await freePort();
 const config={listen_port:companionPort,integrations:{dsh:{enabled:true},comfy:{enabled:true,base_url:'http://127.0.0.1:'+comfyPort}}};
 const qqRoot=path.join(root,'qq'),comfyRoot=path.join(root,'installed-comfy');
 for(const f of ['LilithQQ.app/Contents/MacOS/QQ','LilithQQ.app/Contents/Resources/app/lilith-qq-loader.cjs','napcat/napcat.mjs']){fs.mkdirSync(path.dirname(path.join(qqRoot,f)),{recursive:true});fs.writeFileSync(path.join(qqRoot,f),'fixture');}
 for(const f of ['ComfyUI/.venv/bin/python','ComfyUI/main.py']){fs.mkdirSync(path.dirname(path.join(comfyRoot,f)),{recursive:true});fs.writeFileSync(path.join(comfyRoot,f),'fixture');}
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
 fs.writeFileSync(path.join(root,'startup-services.json'),JSON.stringify({qq:{enabled:true,root:qqRoot},comfy:{enabled:true,installation:comfyRoot}}));
 fs.writeFileSync(path.join(root,'companion-service.cjs'),'fixture');
 const untouched=path.join(qqRoot,'credentials-fixture.json');fs.writeFileSync(untouched,'must remain unchanged');
 const options={root,support:root,waitMs:1,processExists:async()=>false,
  execute:async(command,args,opts)=>{
   assert.equal(args[1],'start');assert.equal(opts.env.LILITH_GAME_PID,undefined);starts++;
   const s=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer test-only-token')return send(res,{error:'unauthorized'},401);
    if(req.url==='/v1/qq')return send(res,{enabled,paused,api_url:'http://127.0.0.1:'+qqPort});
    if(req.url==='/v1/dsh')return send(res,{running:dsh,status:dsh?'native_sdk_connected':'stopped'});
    if(req.url==='/v1/dsh/start'){dsh=true;return send(res,{running:true,status:'native_sdk_connected'});}
    if(req.url==='/v1/qq/probe'){try{const r=await fetch('http://127.0.0.1:'+qqPort);if(r.ok)return send(res,{ok:true});}catch{}return send(res,{error:'qq_protocol_unavailable'},502);}
    return send(res,{error:'not found'},404);
   });servers.push(s);await listen(s,companionPort);fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify({pid:process.pid,host:'127.0.0.1',port:companionPort,token:'test-only-token'}));return {stdout:''};
  },background:async(command,args,opts)=>{
   spawns.push({command,args,opts});let s;
   if(command.endsWith('/QQ')){assert.equal(opts.env.HOME,path.join(qqRoot,'home'));assert.equal(opts.env.NAPCAT_WORKDIR,path.join(qqRoot,'napcat-state'));s=http.createServer((req,res)=>send(res,{ok:loggedIn},loggedIn?200:401));servers.push(s);await listen(s,qqPort);}
   else {assert.equal(opts.cwd,path.join(comfyRoot,'ComfyUI'));assert(args.includes('--disable-all-custom-nodes'));assert(args.includes('--disable-api-nodes'));s=http.createServer((req,res)=>send(res,{system:{comfyui_version:'fixture'}}));servers.push(s);await listen(s,comfyPort);}
   return process.pid;
  }};
 try{
  assert.throws(()=>localURL('https://example.com'),/本机/);assert.throws(()=>localURL('http://user:pass@127.0.0.1'),/本机/);assert.equal(localURL('http://[::1]:8188').hostname,'[::1]');
  const results=await Promise.all([ensureServices(options),ensureServices(options)]);
  assert.equal(starts,1,'concurrent launch must create one Companion');assert.equal(spawns.length,2,'one QQ host and one ComfyUI only');
  assert.equal(results[0].services.companion.state,'started');assert.equal(results[1].services.companion.state,'reused');assert.equal(results[0].services.dsh.state,'started');assert.equal(results[1].services.dsh.state,'reused');
  assert.equal(results[1].services.qq.state,'reused');assert.match(results[1].services.qq.message,/暂停/);assert.equal(paused,true,'launch must not resume QQ');assert.equal(fs.readFileSync(untouched,'utf8'),'must remain unchanged');
  const saved=fs.readFileSync(path.join(root,'startup-status.json'),'utf8');assert(!saved.includes('test-only-token'));assert(!saved.includes('must remain unchanged'));
  loggedIn=false;const attention=await ensureServices(options);assert.equal(attention.services.qq.state,'attention');assert.equal(spawns.length,2,'live logged-out client must never be restarted');
  enabled=false;const disabled=await ensureServices(options);assert.equal(disabled.services.qq.state,'disabled');assert.equal(spawns.length,2);enabled=true;
  const check=await ensureServices({...options,checkOnly:true});assert.equal(check.services.qq.state,'unavailable');assert.equal(spawns.length,2,'check only must never launch');
  const comfy=servers.find(s=>s.listening&&s.address().port===comfyPort);await close(comfy);
  const impostor=http.createServer((req,res)=>send(res,{error:'not comfy'},404));servers.push(impostor);await listen(impostor,comfyPort);
  const conflict=await ensureServices(options);assert.equal(conflict.services.comfy.state,'error');assert.match(conflict.services.comfy.message,/端口/);assert.equal(spawns.length,2,'occupied foreign port must not launch');
  fs.writeFileSync(path.join(root,'.startup-services.lock'),JSON.stringify({pid:2147483647,nonce:'owned-stale-fixture'}));
  await ensureServices({...options,checkOnly:true});assert.equal(fs.existsSync(path.join(root,'.startup-services.lock')),false,'stale lock recovered');
  const companion=servers.find(s=>s.listening&&s.address().port===companionPort);await close(companion);
  const other=http.createServer((req,res)=>send(res,{error:'unauthorized'},401));servers.push(other);await listen(other,companionPort);
  const bad=await ensureServices(options);assert.equal(bad.services.companion.state,'error');assert.equal(bad.services.dsh.state,'unavailable');assert.equal(starts,1,'foreign Companion port cannot trigger duplicate service');
  console.log('startup-services: cold start, concurrent idempotency, authenticated reuse, DSH readiness, paused/expired QQ, no credential writes, occupied-port isolation, check-only and stale lock recovery passed.');
 }finally{for(const s of servers)if(s.listening)await close(s);fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
