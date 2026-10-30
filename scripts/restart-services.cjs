'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
async function restart({data=process.env.LILITH_AI_DATA_DIR||path.join(os.homedir(),'Library/Application Support/LilithAI'),support=__dirname,node=process.execPath,request=fetch,signal=process.kill.bind(process),run=execFileSync,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const file=path.join(data,'runtime.json');let state;try{state=JSON.parse(fs.readFileSync(file));}catch(e){if(e.code!=='ENOENT')throw Error('运行配置无法读取，已保留现有服务。');}
 if(state){
  if(!['127.0.0.1','::1'].includes(state.host)||state.lifecycle!=='standalone'||!Number.isSafeInteger(state.pid)||state.pid<=0||!Number.isInteger(state.port)||state.port<1||state.port>65535||typeof state.token!=='string')throw Error('当前服务不是可安全重启的常驻后台，请先正常退出游戏。');
  let alive=true;try{signal(state.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;alive=false;}
  if(alive){const api=async route=>{const r=await request('http://'+(state.host==='::1'?'[::1]':state.host)+':'+state.port+route,{headers:{Authorization:'Bearer '+state.token},signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('后台身份检查失败，未停止任何进程。');return r.json();};
   const [d,q,p,a,b,s]=await Promise.all([api('/v1/dsh'),api('/v1/qq'),api('/v1/dsh/reply-parts'),api('/v1/art/jobs'),api('/v1/bili'),api('/v1/speech')]);
   if(d.active||d.pending?.length||q.pending||q.group_art_pending||q.private_art_pending||q.qq_voice_pending||p.pending||b.busy||b.pending||s.queued||['preparing','synthesizing','playing','starting'].includes(s.status)||(a.jobs||[]).some(j=>!['completed','failed'].includes(j.status))||(q.outbox||[]).some(x=>['pending','sending'].includes(x.state)))throw Error('后台正在回复或发送内容。请稍等，再双击“重启聊天后台.command”。');
   signal(state.pid,'SIGTERM');let stopped=false;for(let i=0;i<80;i++){try{signal(state.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;stopped=true;break;}await sleep(100);}if(!stopped)throw Error('旧后台尚未退出，未强制结束。请保留日志。');
  }
 }
 run(node,[path.join(support,'companion-service.cjs'),'start'],{stdio:'inherit',env:{...process.env,LILITH_AI_DATA_DIR:data}});return {ok:true};
}
module.exports={restart};
if(require.main===module)restart().then(()=>{console.log('聊天后台已启动。正在重新打开控制台……');execFileSync(process.execPath,[path.join(__dirname,'open-console.cjs'),'--tab=settings'],{stdio:'inherit'});}).catch(e=>{console.error(e.message);process.exitCode=1;});
