'use strict';
const el=id=>document.getElementById(id),hash=new URLSearchParams(location.hash.slice(1));
let token=hash.get('token')||sessionStorage.getItem('lilith-bili-token')||'',poll;
if(hash.has('token')){sessionStorage.setItem('lilith-bili-token',token);history.replaceState(null,'',location.pathname);}
async function api(route,body,method=body?'POST':'GET'){const r=await fetch(route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'接口暂不可用');return value;}
async function refresh(){const s=await api('/v1/bili');el('enabled').checked=s.config?.enabled;el('automatic').checked=s.config?.automatic;el('status').textContent=s.installed?`今日阅读 ${s.usage.rounds}/${s.config.daily_rounds} 轮 · ${s.busy?'正在读':'空闲'} · ${s.bridge?.credential_present?'已有登录凭据':'需要扫码登录'}`:'插件尚未接入';el('records').textContent=JSON.stringify(await api('/v1/bili/records'),null,2);}
function act(id,fn){el(id).onclick=async()=>{el('error').textContent='';el(id).disabled=true;try{await fn();}catch(e){el('error').textContent=e.message;}finally{el(id).disabled=false;}};}
act('login',async()=>{clearTimeout(poll);const qr=await api('/v1/bili/login/start',{});el('qr').src='data:image/png;base64,'+qr.image;el('qr').hidden=false;el('login-state').textContent='请用手机 B站扫码确认';const end=Date.now()+180000;
 const tick=async()=>{if(Date.now()>end){el('login-state').textContent='二维码已过期，请重新生成';return;}try{const s=await api('/v1/bili/login/poll',{id:qr.id});el('login-state').textContent=({waiting:'等待扫码',scanned:'已扫码，请在手机确认',ok:'登录成功，凭据已保存在本机',expired:'二维码已过期，请重新生成'})[s.state]||'等待登录状态';if(['ok','expired'].includes(s.state)){if(s.state==='ok'){el('qr').hidden=true;await refresh();}return;}}catch(e){el('error').textContent=e.message;}poll=setTimeout(tick,1800);};poll=setTimeout(tick,1000);
});
act('check',async()=>{const s=await api('/v1/bili/check',{});el('login-state').textContent=s.logged_in?'登录有效':'尚未登录或登录已过期';await refresh();});
act('save',async()=>{await api('/v1/bili',{enabled:el('enabled').checked,automatic:el('automatic').checked},'PATCH');await refresh();});
act('run',async()=>{const job=await api('/v1/bili/run',{bvid:el('bvid').value.trim()});el('run-state').textContent='阅读已排队，可以继续正常私聊。任务：'+job.id;await refresh();});act('refresh',refresh);
refresh().catch(e=>{el('error').textContent=token?e.message:'请从本机启动脚本打开带认证的页面。';});
