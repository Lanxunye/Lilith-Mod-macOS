window.__ModuleLoader__.load({id:'lilith-dsh-desktop-bridge',factory:require=>{
  const React=require('react'),h=React.createElement;
  const {useEffect,useRef,useState}=React;
  const errors={lilith_service_unavailable:'莉莉丝服务暂不可达，请先启动莉莉丝常驻服务。',lilith_runtime_invalid:'莉莉丝服务信息无效，请重新启动常驻服务。',lilith_csrf_invalid:'连接已刷新，请刷新记录后重试原请求。',lilith_sync_file_changed:'对话导出文件已被外部修改，已停止覆盖该文件；界面续聊仍可使用。',lilith_sync_directory_conflict:'导出目录已有其他内容，未覆盖；界面续聊仍可使用。',lilith_sync_write_failed:'对话文件暂未同步，请检查目录权限。'};
  const css='.lilith-dsh{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;padding:24px;box-sizing:border-box;color:var(--dsw-alias-label-primary,inherit);font:14px/1.65 system-ui}.lilith-dsh h1{font-size:22px;margin:0}.lilith-dsh p{margin:0}.lilith-dsh .hint{font-size:12px;opacity:.7}.lilith-dsh .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.lilith-dsh .log{flex:1;min-height:160px;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid #8884;border-radius:12px}.lilith-dsh article{padding:12px 16px;border-radius:10px;background:#8881;white-space:pre-wrap;overflow-wrap:anywhere}.lilith-dsh article.user{margin-left:12%;background:#8966ba14}.lilith-dsh article.assistant{margin-right:12%}.lilith-dsh header{font-size:12px;opacity:.65;margin-bottom:6px}.lilith-dsh textarea{box-sizing:border-box;resize:vertical;width:100%;min-height:90px;max-height:300px;padding:12px;border:1px solid #8885;border-radius:10px;font:inherit;color:inherit;background:transparent}.lilith-dsh button{padding:7px 14px;border:1px solid #8885;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.lilith-dsh button:disabled{opacity:.45;cursor:default}.lilith-dsh .warning{color:#b66c25}.lilith-dsh details pre{white-space:pre-wrap;max-height:180px;overflow:auto}.lilith-dsh .path{overflow-wrap:anywhere;font-family:monospace}';
  const pendingKey='lilith-dsh-pending-v1';
  const saved=()=>{try{return JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch{return null;}};
  function Page(){
    const [messages,setMessages]=useState([]),[snapshot,setSnapshot]=useState(null),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(saved);
    const cursor=useRef(0),csrf=useRef(''),log=useRef(null),mounted=useRef(true),loading=useRef(false),sending=useRef(false);
    async function api(route,options={}){const r=await fetch('/lilith-bridge/'+route,{credentials:'same-origin',cache:'no-store',...options});const v=await r.json();if(!r.ok)throw Error(v.error||'lilith_service_unavailable');return v;}
    function accept(v){
      if(!mounted.current)return;
      csrf.current=v.csrf;setSnapshot(v);
      setMessages(old=>{const rows=new Map(old.map(r=>[r.seq,r]));if(v.cursor<cursor.current)rows.clear();for(const r of v.messages||[])rows.set(r.seq,r);return [...rows.values()].sort((a,b)=>a.seq-b.seq);});
      cursor.current=v.cursor;setError(v.projection_error||'');
    }
    async function refresh(){if(loading.current)return;loading.current=true;try{accept(await api('snapshot?after='+cursor.current));}catch(e){if(mounted.current)setError(e.message);}finally{loading.current=false;}}
    useEffect(()=>{mounted.current=true;refresh();const id=setInterval(refresh,3000);return()=>{mounted.current=false;clearInterval(id);};},[]);
    useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[messages.length]);
    async function send(retry){
      if(sending.current)return;
      const body=retry?pending:{message:text,request_id:crypto.randomUUID()};
      if(!body?.message?.trim())return;
      sending.current=true;setBusy(true);setError('');
      try{
        if(!csrf.current){const v=await api('snapshot?after='+cursor.current);accept(v);}
        sessionStorage.setItem(pendingKey,JSON.stringify(body));setPending(body);
        const v=await api('message',{method:'POST',headers:{'Content-Type':'application/json','X-Lilith-Bridge':csrf.current},body:JSON.stringify(body)});
        accept(v.snapshot);sessionStorage.removeItem(pendingKey);setPending(null);if(!retry)setText('');
        if(v.result?.status!=='ok')setError(v.result?.fallback_reason||'本轮回复尚未完成，请查看莉莉丝状态。');
      }catch(e){if(mounted.current)setError(e.message);}finally{sending.current=false;if(mounted.current)setBusy(false);}
    }
    const shown=messages.slice(-300);
    return h('section',{className:'lilith-dsh'},h('style',null,css),
      h('h1',null,'莉莉丝 · 同步续聊'),
      h('p',{className:'hint'},'桌宠与绑定主人 QQ 私聊共用记录；在这里续聊会实时回写。QQ 发送遵循现有镜像设置。'),
      h('div',{className:'toolbar'},h('span',{role:'status'},snapshot?'DSH '+(snapshot.dsh.active?'处理中':snapshot.dsh.running?'已连接':'待连接')+' · '+messages.length+' 条记录':'正在连接莉莉丝…'),h('button',{type:'button',onClick:refresh},'刷新记录')),
      error?h('p',{className:'warning',role:'alert'},errors[error]||error):null,
      h('div',{className:'log',ref:log,'aria-label':'莉莉丝同步对话'},shown.map(r=>h('article',{className:r.role,key:r.id||r.seq},h('header',null,(r.role==='assistant'?'莉莉丝':'主人')+' · '+(r.channel==='qq'?'QQ 私聊':r.channel==='desktop'?'桌面':'私聊')+' · '+new Date(r.created_at).toLocaleString()),r.content))),
      snapshot?.pending?.length?h('details',null,h('summary',null,'有 '+snapshot.pending.length+' 项操作等待再次确认'),snapshot.pending.map(r=>h('div',{key:r.id},h('p',null,r.tool_name+' · '+(r.channel==='qq'?'请在原 QQ 对话确认并继续':'核对后在下方输入完整确认短语')),h('pre',null,JSON.stringify(r.arguments,null,2)),h('code',null,'确认执行 '+r.id+' '+r.challenge)))):null,
      h('form',{onSubmit:e=>{e.preventDefault();send(false);}},h('textarea',{'aria-label':'与莉莉丝续聊',placeholder:'写下你的话；删除和高危操作仍需再次明文确认。',maxLength:2000,value:text,onChange:e=>setText(e.target.value),disabled:busy}),h('div',{className:'toolbar'},h('button',{type:'submit',disabled:busy||!text.trim()||Boolean(pending)},busy?'莉莉丝正在回复…':'发送并回写'),pending?h('button',{type:'button',disabled:busy,onClick:()=>send(true)},'重试未确认的原请求'):null)),
      snapshot?h('details',null,h('summary',null,'同步文件与状态'),h('p',{className:'hint path'},snapshot.transcript_file),h('p',{className:'hint'},'JSONL 是聊天库的自动导出；请在上方续聊。直接编辑导出文件不会改写聊天记录。')):null);
  }
  function Icon(){return h('span',{'aria-hidden':true},'✦');}
  return {name:'lilith-desktop-bridge-client',inject:['slots'],apply(ctx){
    ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'lilith',order:35,label:'莉莉丝'},Icon));
    ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'lilith'},Page));
  }};
}});
