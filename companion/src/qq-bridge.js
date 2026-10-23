'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fault}=require('./conversation-store');
const QQ_ID=/^[1-9]\d{4,19}$/;
function atomicJson(file,value){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
function localApi(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw fault('onebot_loopback_required');return u.origin;}
function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function createQQBridge({root,store,chat,getPlayerName,request=fetch,autoTick=true,now=()=>new Date()}){
  const file=path.join(root,'qq.json');
  let cfg={enabled:false,paused:true,owner_qq:'',bot_qq:'',session_id:'desktop-pet',api_url:'http://127.0.0.1:3000',api_token:'',event_secret:crypto.randomBytes(32).toString('hex'),mirror_desktop:true,min_interval_ms:3000,max_per_minute:10,group_enabled:false,group_ids:[]};
  if(fs.existsSync(file))cfg={...cfg,...JSON.parse(fs.readFileSync(file,'utf8'))};
  else atomicJson(file,cfg);
  store.db.exec(`CREATE TABLE IF NOT EXISTS qq_group_rounds (bot TEXT,group_id TEXT,remaining INTEGER NOT NULL,PRIMARY KEY(bot,group_id));
    CREATE TABLE IF NOT EXISTS qq_group_budget (bot TEXT,day TEXT,used INTEGER NOT NULL,PRIMARY KEY(bot,day));`);
  const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
  const used=()=>store.db.prepare('SELECT used FROM qq_group_budget WHERE bot=? AND day=?').get(cfg.bot_qq,day())?.used||0;
  const groupAllowed=id=>cfg.group_enabled&&cfg.group_ids.includes(id);
  const groupSession=id=>`qq-group:${cfg.bot_qq}:${id}`;
  let busy=false,closed=false,lastSend=0,sentTimes=[],lastError='';
  const status=()=>({release_stage:'beta',enabled:cfg.enabled,paused:cfg.paused,owner_id:store.ownerId,owner_qq:cfg.owner_qq,bot_qq:cfg.bot_qq,
    group_enabled:cfg.group_enabled,group_ids:cfg.group_ids,group_daily_limit:50,group_round_limit:10,group_timezone:'Asia/Shanghai',group_day:day(),group_daily_used:used(),
    group_rounds:store.db.prepare('SELECT group_id,remaining FROM qq_group_rounds WHERE bot=?').all(cfg.bot_qq),
    api_url:cfg.api_url,session_id:cfg.session_id,mirror_desktop:cfg.mirror_desktop,min_interval_ms:cfg.min_interval_ms,max_per_minute:cfg.max_per_minute,
    api_token_configured:Boolean(cfg.api_token),event_secret_configured:Boolean(cfg.event_secret),last_error:lastError,
    pending:store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state='pending'").get().n,outbox:store.outbox(),media_support:'text_only'});
  function configure(body){
    const next={...cfg};
    for(const key of ['enabled','paused','mirror_desktop','group_enabled'])if(key in body){if(typeof body[key]!=='boolean')throw fault('invalid_'+key);next[key]=body[key];}
    for(const key of ['owner_qq','bot_qq'])if(key in body){if(!QQ_ID.test(body[key]))throw fault('invalid_'+key);next[key]=String(body[key]);}
    if('group_ids'in body){if(!Array.isArray(body.group_ids)||body.group_ids.length>100||!body.group_ids.every(v=>typeof v==='string'&&QQ_ID.test(v)))throw fault('invalid_group_ids');next.group_ids=[...new Set(body.group_ids)];}
    if('api_url'in body)next.api_url=localApi(body.api_url);
    for(const key of ['api_token','event_secret'])if(body[key]){if(typeof body[key]!=='string'||body[key].length>512)throw fault('invalid_'+key);next[key]=body[key];}
    if('min_interval_ms'in body){if(!Number.isInteger(body.min_interval_ms)||body.min_interval_ms<1000||body.min_interval_ms>60000)throw fault('invalid_interval');next.min_interval_ms=body.min_interval_ms;}
    if('max_per_minute'in body){if(!Number.isInteger(body.max_per_minute)||body.max_per_minute<1||body.max_per_minute>20)throw fault('invalid_quota');next.max_per_minute=body.max_per_minute;}
    if(next.enabled&&(!QQ_ID.test(next.owner_qq)||!QQ_ID.test(next.bot_qq)||next.owner_qq===next.bot_qq||!next.api_token||!next.event_secret))throw fault('qq_binding_incomplete');
    if((next.owner_qq!==cfg.owner_qq||next.bot_qq!==cfg.bot_qq)&&(store.db.prepare("SELECT 1 FROM outbox WHERE state IN ('pending','sending') LIMIT 1").get()||store.db.prepare("SELECT 1 FROM inbox WHERE state IN ('pending','processing') LIMIT 1").get()))throw fault('qq_pending_delivery');
    atomicJson(file,next);cfg=next;lastError='';return status();
  }
  function accept(raw,signature){
    const expected='sha1='+crypto.createHmac('sha1',cfg.event_secret).update(raw).digest('hex');
    if(!equal(signature,expected))throw fault('qq_signature_invalid');
    if(!cfg.enabled||cfg.paused)return {accepted:false,reason:'paused'};
    const e=JSON.parse(raw);
    if(e.post_type==='message'&&e.message_type==='group')return acceptGroup(e);
    if(e.post_type!=='message'||e.message_type!=='private'||e.sub_type!=='friend'||String(e.self_id)!==cfg.bot_qq||String(e.user_id)!==cfg.owner_qq||String(e.user_id)===String(e.self_id))return {accepted:false,reason:'outside_binding'};
    if(!['string','number'].includes(typeof e.message_id)||String(e.message_id).length>100)throw fault('qq_message_id_required');
    // CQ strings are ambiguous (escaped tags/media). Request OneBot array message_format.
    const segments=Array.isArray(e.message)?e.message:[];
    const onlyText=segments.length>0&&segments.every(s=>s.type==='text'&&typeof s.data?.text==='string');
    const text=onlyText?segments.map(s=>s.data.text).join('').trim():'';
    if(text.length>2000)throw fault('qq_message_too_long');
    const id=`qq:${cfg.bot_qq}:${e.message_id}`;
    const count=store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state IN ('pending','processing')").get().n;
    if(count>=20&&!store.db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id))throw fault('qq_queue_full');
    const body={request_id:id,message:text,unsupported:!onlyText||!text,owner:cfg.owner_qq,bot:cfg.bot_qq,session:cfg.session_id};
    const result=store.db.prepare("INSERT OR IGNORE INTO inbox VALUES (?,?,'pending',?)").run(id,JSON.stringify(body),new Date().toISOString());
    return {accepted:true,duplicate:result.changes===0};
  }
  function acceptGroup(e){
    const group=String(e.group_id),sender=String(e.user_id);
    if(String(e.self_id)!==cfg.bot_qq||sender===cfg.bot_qq||!QQ_ID.test(sender)||!groupAllowed(group))return {accepted:false,reason:'outside_binding'};
    if(!['string','number'].includes(typeof e.message_id)||String(e.message_id).length>100)throw fault('qq_message_id_required');
    const id=`qqg:${cfg.bot_qq}:${group}:${e.message_id}`;
    if(store.db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id))return {accepted:true,duplicate:true};
    const segments=Array.isArray(e.message)?e.message:[];
    const mention=segments.some(s=>s.type==='at'&&String(s.data?.qq)===cfg.bot_qq);
    const remaining=store.db.prepare('SELECT remaining FROM qq_group_rounds WHERE bot=? AND group_id=?').get(cfg.bot_qq,group)?.remaining||0;
    if(!remaining&&!mention)return {accepted:false,reason:'mention_required'};
    if(used()>=50)return {accepted:false,reason:'group_daily_limit'};
    if(store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state IN ('pending','processing')").get().n>=20)throw fault('qq_queue_full');
    const onlyText=segments.length>0&&segments.every(s=>s.type==='text'&&typeof s.data?.text==='string'||s.type==='at'||s.type==='reply');
    const text=segments.filter(s=>s.type==='text').map(s=>s.data.text).join('').trim();
    const message=`[群成员 QQ ${sender}] ${text}`;
    if(message.length>2000)throw fault('qq_message_too_long');
    const reply=segments.find(s=>s.type==='reply');
    const speaker={qq:sender,name:String(e.sender?.card||e.sender?.nickname||('群成员'+sender)).replace(/[\x00-\x1f]/g,'').slice(0,64),is_bound_owner:sender===cfg.owner_qq};
    const body={request_id:id,message,text,speaker,mentions:segments.filter(s=>s.type==='at').map(s=>String(s.data?.qq)).filter(v=>QQ_ID.test(v)).slice(0,8),
      reply_id:reply?String(reply.data?.id||'').slice(0,100):null,unsupported:!onlyText||(!text&&!reply),owner:cfg.owner_qq,bot:cfg.bot_qq,group,session:groupSession(group)};
    // One accepted event reserves one of ten reply slots. Repeated @ never resets an active round.
    store.db.exec('BEGIN IMMEDIATE');
    try{
      store.db.prepare("INSERT INTO inbox VALUES (?,?,'pending',?)").run(id,JSON.stringify(body),now().toISOString());
      store.db.prepare('INSERT OR REPLACE INTO qq_group_rounds VALUES (?,?,?)').run(cfg.bot_qq,group,(remaining||10)-1);
      store.db.exec('COMMIT');
    }catch(e){store.db.exec('ROLLBACK');throw e;}
    return {accepted:true,duplicate:false};
  }
  async function api(action,body){
    const r=await request(localApi(cfg.api_url)+'/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.api_token},body:JSON.stringify(body)});
    if(!r.ok)throw fault('onebot_http_'+r.status);const data=await r.json();
    if(data.status!=='ok'||data.retcode!==0)throw fault('onebot_rejected');return data.data;
  }
  async function groupInput(b){
    const speaker=b.speaker||{qq:'unknown',name:'群友',is_bound_owner:false};
    const data={speaker,mentions:b.mentions||[],text:b.text??b.message,quote:null};
    if(b.reply_id!==null&&b.reply_id!==undefined){
      data.quote={message_id:b.reply_id,status:'unavailable'};
      try{
        // Resolve just this referenced message, never files, URLs, forwards or nested replies.
        if(!/^-?\d{1,24}$/.test(b.reply_id))throw fault('invalid_quote_id');
        const quoted=await api('get_msg',{message_id:b.reply_id});
        if(quoted.message_type!=='group'||String(quoted.group_id)!==b.group)throw fault('quote_outside_group');
        if(!QQ_ID.test(String(quoted.sender?.user_id??quoted.user_id)))throw fault('quote_author_missing');
        const segments=Array.isArray(quoted.message)?quoted.message:[];
        data.quote={message_id:b.reply_id,status:'available',speaker:{qq:String(quoted.sender?.user_id??quoted.user_id),name:String(quoted.sender?.card||quoted.sender?.nickname||'').slice(0,64)},
          text:segments.filter(s=>s.type==='text'&&typeof s.data?.text==='string').map(s=>s.data.text).join('').slice(0,480),
          has_unsupported_media:segments.some(s=>!['text','at','reply'].includes(s.type))};
      }catch{ /* A missing/retracted quote must not pause QQ or pretend it was read. */ }
    }
    const prefix=`[群成员 QQ ${speaker.qq}]\n`;
    while(prefix.length+JSON.stringify(data).length>2000){
      if(data.quote?.text?.length)data.quote.text=data.quote.text.slice(0,Math.max(0,data.quote.text.length-100));
      else data.text=data.text.slice(0,Math.max(0,data.text.length-100));
    }
    return prefix+JSON.stringify(data);
  }
  async function probe(){const identity=await api('get_login_info',{});if(String(identity?.user_id)!==cfg.bot_qq)throw fault('qq_bot_identity_mismatch');return {ok:true,bot_qq:String(identity.user_id)};}
  async function tick(){
    if(busy||closed||!cfg.enabled||cfg.paused)return;busy=true;
    try{
      const incoming=store.db.prepare("SELECT * FROM inbox WHERE state='pending' ORDER BY rowid LIMIT 1").get();
      if(incoming){
        const b=JSON.parse(incoming.body);
        if(b.owner!==cfg.owner_qq||b.bot!==cfg.bot_qq||(b.group&&(!groupAllowed(b.group)||used()>=50))){store.db.prepare("UPDATE inbox SET state='cancelled' WHERE id=?").run(incoming.id);return;}
        store.db.prepare("UPDATE inbox SET state='processing' WHERE id=?").run(incoming.id);
        if(b.unsupported)store.enqueue(b.session,b.request_id,b.group?'group:'+b.group:cfg.owner_qq,'这条消息里的图片、表情或其他媒体，我现在还不能识别。请用文字告诉我吧。');
        else {
          const message=b.group?await groupInput(b):b.message;
          await chat(b.session,{request_id:b.request_id,message,player:{name:b.group?(b.speaker?.name||'群友'):getPlayerName()},
            _qq_speaker:b.group?b.speaker?.qq:null,_qq_text:b.group?(b.text??''):null,task_mode:'chat',mode:'in_character',locale:'zh-CN'},b.group?'qq_group':'qq');
        }
        if(closed)return;
        store.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(incoming.id);
      }
      if(cfg.paused||!cfg.enabled)return;
      const timestamp=now().getTime();sentTimes=sentTimes.filter(t=>timestamp-t<60000);
      if(timestamp-lastSend<cfg.min_interval_ms||sentTimes.length>=cfg.max_per_minute)return;
      const out=store.db.prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY rowid LIMIT 1").get();
      if(!out)return;
      const group=out.target.startsWith('group:')?out.target.slice(6):null;
      if(group?(!groupAllowed(group)||used()>=50):out.target!==cfg.owner_qq){store.db.prepare("UPDATE outbox SET state='cancelled' WHERE id=?").run(out.id);return;}
      // Check actual logged-in account before each send; group joining and file APIs are never exposed.
      await probe();if(closed||cfg.paused||!cfg.enabled)return;
      if(group&&!groupAllowed(group))return;
      // Charge the send attempt before network I/O. Unknown receipts consume the budget too.
      store.db.exec('BEGIN IMMEDIATE');
      try{
        if(group)store.db.prepare('INSERT INTO qq_group_budget VALUES (?,?,1) ON CONFLICT(bot,day) DO UPDATE SET used=used+1').run(cfg.bot_qq,day());
        store.db.prepare("UPDATE outbox SET state='sending' WHERE id=? AND state='pending'").run(out.id);
        store.db.exec('COMMIT');
      }catch(e){store.db.exec('ROLLBACK');throw e;}
      lastSend=now().getTime();sentTimes.push(lastSend);
      try{
        const receipt=await api(group?'send_group_msg':'send_private_msg',{...(group?{group_id:group}:{user_id:cfg.owner_qq}),message:[{type:'text',data:{text:out.text}}]});
        if(receipt?.message_id===undefined)throw fault('onebot_missing_receipt');
        store.db.prepare("UPDATE outbox SET state='sent',platform_id=?,error=NULL WHERE id=?").run(String(receipt.message_id),out.id);
      }catch(e){store.db.prepare("UPDATE outbox SET state='unknown',error=? WHERE id=?").run(e.code||'onebot_send_unknown',out.id);throw e;}
    }catch(e){lastError=e.code||'qq_processing_failed';cfg={...cfg,paused:true};atomicJson(file,cfg);}
    finally{busy=false;}
  }
  const timer=autoTick?setInterval(()=>void tick(),500):null;timer?.unref();
  return {status,configure,accept,probe,tick,
    mirror(channel,message,result,session){if(channel==='qq_group'){const group=String(session).split(':')[2];return cfg.enabled&&groupAllowed(group)?{target:'group:'+group,text:result.text}:null;}if(!cfg.enabled)return null;if(channel==='qq')return {target:cfg.owner_qq,text:result.text};
      return !cfg.paused&&cfg.mirror_desktop?{target:cfg.owner_qq,text:`【电脑端对话同步】\n你：${message}\n莉莉丝：${result.text}`}:null;},
    async close(){closed=true;clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,20));},get sessionId(){return cfg.session_id;},get bound(){return cfg.enabled;}};
}
module.exports={createQQBridge,localApi,atomicJson};
