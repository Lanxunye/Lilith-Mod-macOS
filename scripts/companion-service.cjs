#!/usr/bin/env node
'use strict';
// Explicit local service lifecycle. Never kills an unverified/game-owned process.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=process.env.LILITH_AI_DATA_DIR||path.join(os.homedir(),'Library','Application Support','LilithAI');
const runtime=path.join(root,'runtime.json');
async function read(){
  let r;try{r=JSON.parse(fs.readFileSync(runtime,'utf8'));}catch{return null;}
  if(!['127.0.0.1','::1'].includes(r.host)||!Number.isInteger(r.pid)||!r.token)return null;
  try{process.kill(r.pid,0);const url=`http://${r.host==='::1'?'[::1]':r.host}:${r.port}/v1/qq`;
    const response=await fetch(url,{headers:{Authorization:'Bearer '+r.token},signal:AbortSignal.timeout(2000)});
    return response.ok?r:null;}catch{return null;}
}
(async()=>{
  const action=process.argv[2]||'status';let r=await read();
  if(action==='status'){console.log(r?`Companion ${r.lifecycle||'game'} pid=${r.pid} port=${r.port}`:'Companion stopped');return;}
  if(action==='stop'){
    if(!r){console.log('Companion stopped');return;}
    if(r.lifecycle!=='standalone')throw Error('当前服务由游戏持有；先退出游戏，再启动常驻服务。');
    process.kill(r.pid,'SIGTERM');console.log('已请求停止常驻服务。');return;
  }
  if(action!=='start')throw Error('Usage: companion-service.cjs start|stop|status');
  if(r){if(r.lifecycle!=='standalone')throw Error('当前服务随游戏运行。请先退出游戏，再启动常驻服务；当前游戏保持运行。');console.log(`已连接常驻服务 pid=${r.pid}`);return;}
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const out=fs.openSync(path.join(root,'companion-service.log'),'a',0o600);
  const env={...process.env,LILITH_AI_DATA_DIR:root};delete env.LILITH_GAME_PID;
  const serverScript=[path.resolve(__dirname,'../companion/src/server.js'),path.resolve(__dirname,'../BepInEx/plugins/companion/src/server.js')].find(f=>fs.existsSync(f));
  if(!serverScript)throw Error('Companion source missing');
  const child=spawn(process.execPath,[serverScript],{env,detached:true,stdio:['ignore',out,out]});child.unref();fs.closeSync(out);
  for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,100));r=await read();if(r&&r.pid===child.pid){console.log(`常驻服务已启动 pid=${r.pid} port=${r.port}`);return;}}
  throw Error('常驻服务未就绪；请检查私有数据目录 companion-service.log。');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
