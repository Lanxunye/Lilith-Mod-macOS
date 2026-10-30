#!/usr/bin/env node
'use strict';
// Launch only explicitly configured, already installed services. Never install,
// kill existing services, rotate credentials, resume QQ or submit messages/jobs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const labels={companion:'聊天后台',dsh:'DSH',qq:'QQ 协议端',comfy:'小画室'};
const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
function write(file,value){const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function localURL(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('仅支持本机服务地址');return u;}
async function occupied(u){return new Promise(resolve=>{const s=net.connect({host:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port)||80});let done=false;const end=v=>{if(done)return;done=true;s.destroy();resolve(v);};s.once('connect',()=>end(true));s.once('error',()=>end(false));s.setTimeout(1000,()=>end(true));});}
async function json(url,init={},timeout=2000){const r=await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});let body;try{body=await r.json();}catch{throw Error('服务返回无效数据');}if(!r.ok)throw Error(typeof body.error==='string'?body.error:'服务请求失败');return body;}
function background(command,args,options){
 fs.mkdirSync(path.dirname(options.log),{recursive:true,mode:0o700});const fd=fs.openSync(options.log,'a',0o600);
 const child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:true,stdin:'ignore',stdio:['ignore',fd,fd]});fs.closeSync(fd);
 return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(child.pid);});});
}
async function processExists(executable){const {stdout}=await execute('/bin/ps',['-axo','comm='],{maxBuffer:2*1024*1024});return stdout.split('\n').some(x=>x.trim()===executable);}
async function waitFor(check,timeout){const until=Date.now()+timeout;do{try{const v=await check();if(v)return v;}catch{}await sleep(400);}while(Date.now()<until);return null;}
async function acquire(root,timeout=90000){const file=path.join(root,'.startup-services.lock'),nonce=crypto.randomUUID(),until=Date.now()+timeout;
 while(true){try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,nonce}));fs.closeSync(fd);return()=>{const v=read(file);if(v?.pid===process.pid&&v.nonce===nonce)fs.unlinkSync(file);};}catch(e){if(e.code!=='EEXIST')throw e;const v=read(file);if(v&&Number.isSafeInteger(v.pid)&&v.pid>0){try{process.kill(v.pid,0);}catch(err){if(err.code==='ESRCH'){if(read(file)?.nonce===v.nonce)fs.unlinkSync(file);continue;}}}if(Date.now()>=until)throw Error('另一个启动流程尚未完成，请稍后重试');await sleep(300);}}
}
async function ensureServices(options={}){
 const root=options.root||process.env.LILITH_AI_DATA_DIR||path.join(os.homedir(),'Library/Application Support/LilithAI');
 const support=options.support||__dirname,config=read(path.join(root,'config.json'))||{},settings=read(path.join(root,'startup-services.json'))||{};
 const start=options.background||background,exists=options.processExists||processExists,run=options.execute||execute;
 const waitMs=options.waitMs||25000,checkOnly=options.checkOnly===true,report={at:new Date().toISOString(),check_only:checkOnly,services:{}};
 const log=options.log||(()=>{}),put=(name,state,message)=>{report.services[name]={state,message};log(labels[name]+'：'+message);};
 fs.mkdirSync(root,{recursive:true,mode:0o700});const release=await acquire(root);
 let runtime;
 const api=async(route,body,timeout=2500)=>{runtime=read(path.join(root,'runtime.json'));if(!runtime||!Number.isSafeInteger(runtime.pid)||runtime.pid<=0||!runtime.token||!['127.0.0.1','::1'].includes(runtime.host)||runtime.port!==(Number(config.listen_port)||6186))throw Error('聊天后台尚未就绪');process.kill(runtime.pid,0);const base='http://'+(runtime.host==='::1'?'[::1]':runtime.host)+':'+runtime.port;return json(base+route,{headers:{Authorization:'Bearer '+runtime.token,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})},timeout);};
 async function companion(){
  try{await api('/v1/qq');put('companion','reused','已连接现有后台');return true;}catch{}
  if(checkOnly){put('companion','unavailable','后台未连接');return false;}
  const u=localURL('http://'+(config.listen_host==='::1'?'[::1]':config.listen_host||'127.0.0.1')+':'+(Number(config.listen_port)||6186));
  if(await occupied(u))throw Error('端口已占用但后台鉴权未通过，未启动重复进程');
  const script=path.join(support,'companion-service.cjs');if(!fs.existsSync(script))throw Error('缺少聊天后台启动脚本');
  const env={...process.env,LILITH_AI_DATA_DIR:root};delete env.LILITH_GAME_PID;
  await run(process.execPath,[script,'start'],{env,timeout:15000,maxBuffer:16384});
  await api('/v1/qq');put('companion','started','已启动常驻后台');return true;
 }
 async function dsh(){
  if(!config.integrations?.dsh?.enabled){put('dsh','disabled','配置未启用');return;}
  const s=await api('/v1/dsh');if(s.running&&s.status==='native_sdk_connected'){put('dsh','reused','已连接原生会话');return;}
  if(checkOnly){put('dsh','unavailable','尚未连接');return;}
  const result=await api('/v1/dsh/start',{},45000);if(!result.running||result.status!=='native_sdk_connected')throw Error('原生会话未就绪');put('dsh','started','已连接原生会话');
 }
 async function qq(){
  const q=await api('/v1/qq');if(!q.enabled){put('qq','disabled','QQ 桥未启用');return;}
  const probe=async()=>{const s=await api('/v1/qq/probe',{},3000);return s.ok===true;};
  try{if(await probe()){put('qq','reused',q.paused?'协议端已连接，保留暂停设置':'登录与桥接检查通过');return;}}catch{}
  if(checkOnly){put('qq','unavailable','协议端尚未就绪或需要登录');return;}
  if(settings.qq?.enabled!==true){put('qq','unavailable','未配置自动启动；请启动已有 QQ 协议端');return;}
  const u=localURL(q.api_url),folder=settings.qq.root;
  if(typeof folder!=='string'||!path.isAbsolute(folder))throw Error('QQ 安装目录未配置');
  const executable=path.join(folder,'LilithQQ.app/Contents/MacOS/QQ');
  // A live protocol endpoint or host is never restarted, including login/401 errors.
  const live=await occupied(u)||await exists(executable);
  if(!live){
   for(const f of [executable,path.join(folder,'napcat/napcat.mjs'),path.join(folder,'LilithQQ.app/Contents/Resources/app/lilith-qq-loader.cjs')])if(!fs.statSync(f).isFile())throw Error('缺少已安装的 QQ 协议端文件');
   const env={...process.env,HOME:path.join(folder,'home'),CFFIXED_USER_HOME:path.join(folder,'home'),NAPCAT_WORKDIR:path.join(folder,'napcat-state'),NAPCAT_QQ_PACKAGE_INFO_PATH:path.join(folder,'LilithQQ.app/Contents/Resources/app/package.json'),NAPCAT_DISABLE_MULTI_PROCESS:'1',NAPCAT_DISABLE_TIME_SYNC:'1'};delete env.ELECTRON_RUN_AS_NODE;
   const pid=await start(executable,['--no-sandbox','--user-data-dir='+path.join(folder,'electron-user-data')],{cwd:folder,env,log:path.join(root,'service-logs/qq-startup.log')});
   write(path.join(root,'qq-startup-process.json'),{pid,executable,started_at:new Date().toISOString()});
  }
  if(await waitFor(probe,waitMs))put('qq',live?'reused':'started',q.paused?'协议端已连接，保留暂停设置':'登录与桥接检查通过');
  else put('qq','attention','客户端已保留运行；可能需要扫码登录，或检查 OneBot 端口与鉴权');
 }
 async function comfy(){
  const c=config.integrations?.comfy;if(!c?.enabled){put('comfy','disabled','配置未启用');return;}
  const u=localURL(c.base_url||'http://127.0.0.1:8188'),base=u.toString().replace(/\/$/,'');
  const probe=async()=>{const s=await json(base+'/system_stats');return !!s.system;};
  try{if(await probe()){put('comfy','reused','绘图后端已在线');return;}}catch{}
  if(checkOnly){put('comfy','unavailable','绘图后端未连接');return;}
  if(settings.comfy?.enabled!==true){put('comfy','unavailable','未配置自动启动；请启动已有 ComfyUI');return;}
  if(await occupied(u))throw Error('绘图端口已有其他服务，未启动重复进程');
  const installation=settings.comfy.installation;if(typeof installation!=='string'||!path.isAbsolute(installation))throw Error('ComfyUI 安装目录未配置');
  const cwd=path.join(installation,'ComfyUI'),python=path.join(cwd,'.venv/bin/python');
  for(const f of [python,path.join(cwd,'main.py')])if(!fs.statSync(f).isFile())throw Error('缺少已有 ComfyUI 安装文件');
  const pid=await start(python,['main.py','--listen',u.hostname==='localhost'?'127.0.0.1':u.hostname.replace(/^\[|\]$/g,''),'--port',u.port||'80','--disable-all-custom-nodes','--disable-api-nodes','--preview-method','none'],{cwd,env:{...process.env},log:path.join(root,'service-logs/comfy-startup.log')});
  write(path.join(root,'comfy-startup-process.json'),{pid,executable:python,started_at:new Date().toISOString()});
  if(await waitFor(probe,waitMs))put('comfy','started','绘图后端已启动');else put('comfy','attention','进程已启动，尚未就绪；请查看本机启动日志');
 }
 const safe=async(name,fn)=>{try{return await fn();}catch(e){const message=e.code==='ENOENT'?'缺少已配置的安装文件':e.code==='EACCES'?'系统拒绝访问已配置的服务':e.message;put(name,'error',String(message).replace(/Bearer\s+\S+/gi,'[隐藏]').slice(0,220));return false;}};
 try{if(await safe('companion',companion))await Promise.allSettled([safe('dsh',dsh),safe('qq',qq),safe('comfy',comfy)]);
  else{for(const name of ['dsh','qq','comfy'])put(name,'unavailable','聊天后台未就绪，请先检查后台');}
  write(path.join(root,checkOnly?'startup-check.json':'startup-status.json'),report);return report;
 }finally{release();}
}
if(require.main===module)ensureServices({checkOnly:process.argv.includes('--check'),log:console.log}).then(r=>{if(Object.values(r.services).some(x=>['error','unavailable','attention'].includes(x.state)))process.exitCode=1;}).catch(e=>{console.error('服务启动检查：'+e.message);process.exitCode=1;});
module.exports={ensureServices,localURL};
