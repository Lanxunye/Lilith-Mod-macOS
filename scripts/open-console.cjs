#!/usr/bin/env node
'use strict';
// Opens the authenticated local console without printing the bearer token.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
(async()=>{
 if(!process.versions.node.startsWith('24.'))throw Error('需要 Node.js 24。');
 const tab=process.argv.find(a=>a.startsWith('--tab='))?.slice(6)||'chat';
 if(!['chat','settings','qq','art','bili'].includes(tab))throw Error('支持 --tab=chat|settings|qq|art|bili');
 const check=process.argv.includes('--check');
 if(!check)await require('./startup-services.cjs').ensureServices({support:__dirname,log:console.log});
 const root=process.env.LILITH_AI_DATA_DIR||path.join(os.homedir(),'Library/Application Support/LilithAI');
 const runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime.json'),'utf8'));
 if(!['127.0.0.1','::1'].includes(runtime.host)||!Number.isInteger(runtime.port)||runtime.port<1||runtime.port>65535||!runtime.token)throw Error('本机运行配置无效。');
 const base=`http://${runtime.host==='::1'?'[::1]':runtime.host}:${runtime.port}`;
 const response=await fetch(base+'/v1/qq',{headers:{Authorization:'Bearer '+runtime.token},signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error('本机服务鉴权失败；请检查常驻服务状态。');
 const url=base+'/ui/'+tab;
 if(check){console.log('WebUI 已就绪：'+url+'（认证密钥已隐藏）');return;}
 if(process.platform!=='darwin')throw Error('自动打开仅支持 macOS；可读取本机 runtime.json 进行手动认证。');
 const child=spawn('/usr/bin/open',[url+'#token='+encodeURIComponent(runtime.token)],{stdio:'ignore'});
 child.on('error',()=>{console.error('浏览器打开失败。');process.exitCode=1;});
 child.on('exit',code=>{if(code){console.error('浏览器打开失败。');process.exitCode=1;}});
})().catch(()=>{console.error('控制台启动失败。请确认 Node 24、服务状态及 LILITH_AI_DATA_DIR 设置；未输出认证密钥。');process.exitCode=1;});
