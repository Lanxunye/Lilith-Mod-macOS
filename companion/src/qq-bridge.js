'use strict';
const {intentFor}=require('./sticker-selection');
const {groupFacts}=require('./qq-group-context');
const {wantsVideoLink,isVideoUrl,stripVideoLinks}=require('./bili-links');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fault}=require('./conversation-store');
const {DEFAULTS,patchCapabilities,createQQCapabilities}=require('./qq-capabilities');
const {createQQMind}=require('./qq-mind');
const {createQQSpeech}=require('./qq-speech');
const {correctedDescription}=require('./meme-library');
const {createQQGroupArt}=require('./qq-group-art');
const {createQQPrivateArt,privateMention}=require('./qq-private-art');
const QQ_ID=/^[1-9]\d{4,19}$/;
function atomicJson(file,value){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
function localApi(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw fault('onebot_loopback_required');return u.origin;}
function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function createQQBridge({root,store,chat,getPlayerName,request=fetch,autoTick=true,now=()=>new Date(),random=Math.random,getProvider=()=>({}),getCanon=()=>({}),decide:decideOverride,capabilitiesOptions={},allowProactive=()=>false,onInbound=()=>{},speechStatus=()=>({enabled:false}),speechHealth=async()=>null,artwork,onArtDelivery=()=>{}}){
  const file=path.join(root,'qq.json');
  let cfg={...DEFAULTS,enabled:false,paused:true,owner_qq:'',bot_qq:'',session_id:'desktop-pet',api_url:'http://127.0.0.1:3000',api_token:'',event_secret:crypto.randomBytes(32).toString('hex'),mirror_desktop:true,min_interval_ms:3000,max_per_minute:10,group_enabled:false,group_ids:[]};
  if(fs.existsSync(file))cfg={...cfg,...JSON.parse(fs.readFileSync(file,'utf8'))};
  else atomicJson(file,cfg);
  store.db.exec(`CREATE TABLE IF NOT EXISTS qq_collection_log (id TEXT PRIMARY KEY,status TEXT NOT NULL,recognized INTEGER NOT NULL,stickers INTEGER NOT NULL,attempts INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS qq_group_rounds (bot TEXT,group_id TEXT,remaining INTEGER NOT NULL,PRIMARY KEY(bot,group_id));
    CREATE TABLE IF NOT EXISTS qq_observed (id TEXT PRIMARY KEY,bot TEXT,group_id TEXT,body TEXT,created_ms INTEGER);
    CREATE TABLE IF NOT EXISTS qq_social_state (bot TEXT,group_id TEXT,last_inbound INTEGER DEFAULT 0,last_sent INTEGER DEFAULT 0,last_decision INTEGER DEFAULT 0,last_proactive INTEGER DEFAULT 0,topic TEXT DEFAULT '',active INTEGER DEFAULT 0,sticker_streak INTEGER DEFAULT 0,PRIMARY KEY(bot,group_id));
    CREATE TABLE IF NOT EXISTS qq_decisions (bot TEXT,group_id TEXT,created_ms INTEGER);
    CREATE INDEX IF NOT EXISTS qq_decision_time ON qq_decisions(bot,created_ms);
    CREATE TABLE IF NOT EXISTS qq_delivery_meta (id TEXT PRIMARY KEY,body TEXT);
    CREATE TABLE IF NOT EXISTS qq_group_budget (bot TEXT,day TEXT,used INTEGER NOT NULL,PRIMARY KEY(bot,day));
    CREATE TABLE IF NOT EXISTS qq_private_deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,bot TEXT,owner TEXT,created_ms INTEGER,sticker INTEGER,state TEXT);`);
  const capabilities=createQQCapabilities({root,store,getConfig:()=>cfg,getProvider,getCanon,now:()=>now().getTime(),...capabilitiesOptions});
  const mind=createQQMind({store,getConfig:()=>cfg,now});
  const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
  const used=()=>store.db.prepare('SELECT used FROM qq_group_budget WHERE bot=? AND day=?').get(cfg.bot_qq,day())?.used||0;
  const groupAllowed=id=>cfg.group_enabled&&cfg.group_ids.includes(id);
  const groupSession=id=>`qq-group:${cfg.bot_qq}:${id}`;
  function privateCadence(){
    const last=store.db.prepare('SELECT MAX(seq) AS seq FROM qq_private_deliveries WHERE bot=? AND owner=? AND sticker=1').get(cfg.bot_qq,cfg.owner_qq).seq||0;
    const since=store.db.prepare("SELECT COUNT(*) AS n FROM qq_private_deliveries WHERE bot=? AND owner=? AND seq>? AND state='sent'").get(cfg.bot_qq,cfg.owner_qq,last).n;
    return {every:3,confirmed_since_last_sticker:since,eligible:since>=2};
  }
  function privateMediaContext(session,planned=null){
    const rows=store.db.prepare(`SELECT d.sticker,o.state,o.platform_id,o.text,d.created_ms,m.body FROM qq_private_deliveries d
      JOIN outbox o ON o.id=d.id JOIN qq_delivery_meta m ON m.id=d.id
      WHERE d.bot=? AND d.owner=? AND o.session=? AND (d.sticker=1 OR json_extract(m.body,'$.sticker_id') IS NOT NULL)
      ORDER BY d.seq DESC LIMIT 8`).all(cfg.bot_qq,cfg.owner_qq,session);
    const deliveries=rows.reverse().map(row=>{
      const meta=JSON.parse(row.body),stored=meta.sticker_description||store.db.prepare('SELECT description FROM qq_stickers WHERE id=? AND scope=?').get(meta.sticker_id,'private:'+cfg.owner_qq)?.description||'一张已有表情';
      const image=meta.sticker_child_id?store.db.prepare('SELECT state,platform_id FROM outbox WHERE id=?').get(meta.sticker_child_id):row;
      const deferred=meta.burst_total>1&&!meta.sticker_child_id;
      const pending=deferred&&store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(meta.burst_id)?.state==='pending';
      const description=correctedDescription(meta.sticker_id,stored);
      return {sticker_id:meta.sticker_id,at:row.created_ms,assistant_text:row.text.slice(0,200),description:String(description).slice(0,600),source:description===stored?'library_visual_description':'owner_reviewed_sticker_interpretation',
        image_state:deferred?(pending&&row.sticker?'pending':'not_sent'):image?.state==='cancelled'?'not_sent':meta.sticker_child_id&&image?.state==='pending'?'pending':row.sticker?image?.state==='sent'&&image.platform_id!==null?'sent':image?.state==='unknown'?'unknown':'pending':'not_sent'};
    });
    return {private_drawing:{enabled:cfg.private_art_enabled,requires_mention:true,daily_limit:null,recent:privateArt.recent()},enabled:cfg.private_stickers_enabled&&cfg.stickers_enabled,selection_timing:'after_reply',cadence:privateCadence(),planned_sticker:planned?{description:String(planned).slice(0,600),state:'planned'}:null,recent_image_deliveries:deliveries};
  }
  let busy=false,closed=false,lastSend=0,sentTimes=[],lastError='';
  async function selectAfterPrivateReply(b,mindInput,result,watermark){
    const current=()=>!closed&&cfg.enabled&&!cfg.paused&&!cfg.collection_only&&cfg.owner_qq===b.owner&&cfg.bot_qq===b.bot&&privateWatermark()===watermark&&cfg.private_stickers_enabled&&cfg.stickers_enabled&&privateCadence().eligible&&!mind.preflight(mindInput);
    if(!current()||b.unsupported||result&&result.status!=='ok'||/报错|故障|求助|请解释|帮我分析|难过|伤心|失落|去世|悲痛/.test(b.text||''))return;
    const root='qq:'+b.request_id,out=store.db.prepare('SELECT * FROM outbox WHERE id=?').get(root);
    if(!out||out.state!=='pending')return;
    const batch=store.db.prepare('SELECT parts,state FROM reply_batches WHERE session=? AND request_id=?').get(b.session,b.request_id);
    if(batch?.state==='cancelled')return;
    const reply=batch?JSON.parse(batch.parts).map(p=>p.text).join('\n'):out.text;
    if(!reply)return;
    const recent=store.recent(b.session,12).map(m=>({role:m.role,text:m.content.slice(0,400)})),intent=intentFor({current:b.text||'',reply,recent});
    mindInput.stickers=capabilities.stickers(mindInput.scope,(b.text||'')+' '+reply,{current:b.text||'',reply,recent});
    const selected=await capabilities.decidePrivate({current:{text:b.text??b.message,images:b.images||null},reply,recent,media:privateMediaContext(b.session),mind:cfg.mind_mode==='active'?mind.snapshot(mindInput.scope,mindInput.member):null,stickers:mindInput.stickers});
    if(!current())return;
    const effective=mind.evaluate(mindInput,{action:'reply',sticker_id:selected}).effective;
    const image=effective.action==='reply'&&effective.sticker_id?capabilities.stickerSegment(effective.sticker_id,mindInput.scope):null;
    const choice=image?mindInput.stickers.find(s=>s.id===effective.sticker_id):null;
    // The local part timer may have staged tails while the selector was running.
    // Patch the root and every already-staged tail, retaining their batch guards.
    for(const row of store.db.prepare("SELECT id,body FROM qq_delivery_meta WHERE id=? OR json_extract(body,'$.burst_root')=?").all(root,root)){
      const meta=JSON.parse(row.body);store.db.prepare('UPDATE qq_delivery_meta SET body=? WHERE id=?').run(JSON.stringify({...meta,sticker_id:choice?.id||null,sticker_description:choice?.description||null,sticker_selection_intent:intent,sticker_selection_timing:'after_reply'}),row.id);
    }
  }

  const privateArt=createQQPrivateArt({store,getConfig:()=>cfg,artwork,now,respond:async b=>{
    store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+b.request_id,JSON.stringify({scope:'private:'+b.owner,member:b.owner,force:true,created_ms:now().getTime(),sources:[]}));
    await chat(b.session,{request_id:b.request_id,message:b.message,player:{name:getPlayerName()},_qq_art_feedback:true,_qq_media:privateMediaContext(b.session),_qq_memory_text:b.text||'',_qq_input_ids:[b.request_id],task_mode:'chat',mode:'in_character',locale:'zh-CN'},'qq');
  }});
  const groupArt=createQQGroupArt({store,getConfig:()=>cfg,artwork,now,day,groupAllowed,respond:async b=>{
    store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+b.request_id,JSON.stringify({scope:'group:'+b.group,member:b.speaker?.qq||'0',force:true,reply_id:b.message_id,created_ms:now().getTime(),sources:[]}));
    await chat(b.session,{request_id:b.request_id,message:await groupInput(b),player:{name:b.speaker?.name||'群友'},
      _qq_art_feedback:true,_qq_member_ids:[b.speaker?.qq].filter(Boolean),_qq_speaker:b.speaker?.qq,_qq_text:b.text,
      _qq_sources:[],_qq_recent:context(b.group),_qq_self_recent:store.db.prepare('SELECT text,state FROM outbox WHERE target=? ORDER BY rowid DESC LIMIT 4').all('group:'+b.group),
      _qq_input_ids:[b.request_id],task_mode:'chat',mode:'in_character',locale:'zh-CN'},'qq_group');
  }});
  const qqSpeech=createQQSpeech({store,getConfig:()=>cfg,configure,speechStatus,speechHealth,groupArtStatus:()=>groupArt.status(),capabilities,api,probe,watermark:privateWatermark,groupWatermark:id=>store.db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM qq_observed WHERE bot=? AND group_id=?').get(cfg.bot_qq,id).n,groupAllowed,now,
    canSend:()=>{const stamp=now().getTime();sentTimes=sentTimes.filter(t=>stamp-t<60000);return stamp-lastSend>=cfg.min_interval_ms&&sentTimes.length<cfg.max_per_minute;},
    charge:()=>{lastSend=now().getTime();sentTimes.push(lastSend);}});
  function privateWatermark(){return store.db.prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM inbox WHERE json_extract(body,'$.group') IS NULL AND json_extract(body,'$.owner')=?").get(cfg.owner_qq).n;}
  function cancelSticker(out,meta,reason){
    store.db.exec('BEGIN IMMEDIATE');try{
      store.db.prepare("UPDATE outbox SET state='cancelled',error=? WHERE id=?").run(reason,out.id);
      if(meta.sticker_parent)store.db.prepare('UPDATE qq_private_deliveries SET sticker=0 WHERE id=?').run(meta.delivery_root||meta.burst_root||meta.sticker_parent);
      store.db.exec('COMMIT');
    }catch(e){store.db.exec('ROLLBACK');throw e;}
  }
  const collectionStatus=()=>{const row=store.db.prepare('SELECT status,recognized,stickers,attempts,updated_at AS at FROM qq_collection_log ORDER BY updated_at DESC,rowid DESC LIMIT 1').get();return row||null;};
  const status=()=>({release_stage:'released',enabled:cfg.enabled,paused:cfg.paused,owner_id:store.ownerId,owner_qq:cfg.owner_qq,bot_qq:cfg.bot_qq,
    group_enabled:cfg.group_enabled,group_ids:cfg.group_ids,group_daily_limit:100,group_round_limit:null,group_timezone:'Asia/Shanghai',group_day:day(),group_daily_used:used(),
    collection_status:collectionStatus(),collection_failed:store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state='collection_failed'").get().n,group_rounds:[],social_state:store.db.prepare('SELECT group_id,topic,active,last_inbound,last_sent FROM qq_social_state WHERE bot=?').all(cfg.bot_qq),...capabilities.status(),...qqSpeech.status(),...groupArt.status(),...privateArt.status(),
    api_url:cfg.api_url,session_id:cfg.session_id,mirror_desktop:cfg.mirror_desktop,min_interval_ms:cfg.min_interval_ms,max_per_minute:cfg.max_per_minute,private_sticker_cadence:privateCadence(),
    api_token_configured:Boolean(cfg.api_token),event_secret_configured:Boolean(cfg.event_secret),last_error:lastError,
    pending:store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state='pending'").get().n,outbox:store.outbox(),media_support:cfg.vision_enabled?'text_and_images':'text_only',sticker_delivery_mode:'standalone_unquoted'});
  function configure(body){
    const next={...cfg};patchCapabilities(next,body);
    for(const key of ['enabled','paused','mirror_desktop','group_enabled'])if(key in body){if(typeof body[key]!=='boolean')throw fault('invalid_'+key);next[key]=body[key];}
    for(const key of ['owner_qq','bot_qq'])if(key in body){if(!QQ_ID.test(body[key]))throw fault('invalid_'+key);next[key]=String(body[key]);}
    if('group_ids'in body){if(!Array.isArray(body.group_ids)||body.group_ids.length>100||!body.group_ids.every(v=>typeof v==='string'&&QQ_ID.test(v)))throw fault('invalid_group_ids');next.group_ids=[...new Set(body.group_ids)];}
    if('api_url'in body)next.api_url=localApi(body.api_url);
    for(const key of ['api_token','event_secret'])if(body[key]){if(typeof body[key]!=='string'||body[key].length>512)throw fault('invalid_'+key);next[key]=body[key];}
    if('min_interval_ms'in body){if(!Number.isInteger(body.min_interval_ms)||body.min_interval_ms<1000||body.min_interval_ms>60000)throw fault('invalid_interval');next.min_interval_ms=body.min_interval_ms;}
    if('max_per_minute'in body){if(!Number.isInteger(body.max_per_minute)||body.max_per_minute<1||body.max_per_minute>20)throw fault('invalid_quota');next.max_per_minute=body.max_per_minute;}
    if(next.enabled&&(!QQ_ID.test(next.owner_qq)||!QQ_ID.test(next.bot_qq)||next.owner_qq===next.bot_qq||!next.api_token||!next.event_secret))throw fault('qq_binding_incomplete');
    if((next.owner_qq!==cfg.owner_qq||next.bot_qq!==cfg.bot_qq)&&(store.db.prepare("SELECT 1 FROM outbox WHERE state IN ('pending','sending') LIMIT 1").get()||store.db.prepare("SELECT 1 FROM inbox WHERE state IN ('pending','processing') LIMIT 1").get()))throw fault('qq_pending_delivery');
    if(next.collection_only){next.paused=true;store.db.prepare("UPDATE outbox SET state='cancelled',error='qq_collection_only' WHERE state='pending'").run();}
    atomicJson(file,next);cfg=next;if('voice_mode'in body)qqSpeech.cancelPending();else{if('voice_enabled'in body)qqSpeech.cancelPending('private');if('group_voice_enabled'in body||'group_enabled'in body||'group_ids'in body)qqSpeech.cancelPending('group');}
    if(!cfg.group_enabled){
      store.db.prepare("UPDATE inbox SET state='cancelled' WHERE state='pending' AND json_extract(body,'$.group') IS NOT NULL").run();
      store.db.prepare("UPDATE outbox SET state='cancelled',error='group_disabled' WHERE state='pending' AND target LIKE 'group:%'").run();
      for(const row of store.db.prepare("SELECT id FROM reply_batches WHERE channel='qq_group' AND state='pending'").all())store.cancelBatch(row.id,'group_disabled');
    }
    if(!cfg.group_enabled||!cfg.group_art_enabled||cfg.collection_only)groupArt.cancelPending();
    if(!cfg.private_art_enabled||cfg.collection_only)privateArt.cancelPending();
    lastError='';return status();
  }
  function accept(raw,signature){
    const expected='sha1='+crypto.createHmac('sha1',cfg.event_secret).update(raw).digest('hex');
    if(!equal(signature,expected))throw fault('qq_signature_invalid');
    if(!cfg.enabled)return {accepted:false,reason:'paused'};
    const e=JSON.parse(raw);
    if(e.post_type==='message'&&e.message_type==='group'){if(cfg.paused&&!cfg.collection_only)return {accepted:false,reason:'paused'};return cfg.collection_only?{accepted:false,reason:'collection_owner_private_only'}:acceptGroup(e);}
    if(e.post_type!=='message'||e.message_type!=='private'||e.sub_type!=='friend'||String(e.self_id)!==cfg.bot_qq||String(e.user_id)!==cfg.owner_qq||String(e.user_id)===String(e.self_id))return {accepted:false,reason:'outside_binding'};
    if(!['string','number'].includes(typeof e.message_id)||String(e.message_id).length>100)throw fault('qq_message_id_required');
    // CQ strings are ambiguous (escaped tags/media). Request OneBot array message_format.
    const segments=Array.isArray(e.message)?e.message:[];
    const hasImage=segments.some(s=>s.type==='image'),reply=segments.find(s=>s.type==='reply');

    const onlyText=segments.length>0&&segments.every(s=>s.type==='text'&&typeof s.data?.text==='string');
    const text=segments.filter(s=>s.type==='text'&&typeof s.data?.text==='string').map(s=>s.data.text).join('').trim();
    if(text.length>2000)throw fault('qq_message_too_long');
    const id=`qq:${cfg.bot_qq}:${e.message_id}`;
    if(onlyText&&qqSpeech.accept(id,text))return {accepted:true,command:true};
    if(cfg.paused&&!cfg.collection_only)return {accepted:false,reason:'paused'};
    if(cfg.collection_only&&!hasImage)return {accepted:false,reason:'collection_images_only'};
    const count=store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state IN ('pending','processing')").get().n;
    if(count>=(cfg.collection_only?200:20)&&!store.db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id))throw fault('qq_queue_full');
    const drawingMention=privateMention(segments,text,cfg.bot_qq);
    const body={request_id:id,message:text||(reply?'（引用了一条历史消息）':'请看这张图片。'),text,force:drawingMention.force,drawing_text:drawingMention.text,has_image:hasImage,reply_id:reply?String(reply.data?.id||'').slice(0,100):null,message_id:String(e.message_id),unsupported:segments.some(s=>!['text','image','at','reply'].includes(s.type))||(!text&&!reply&&!(hasImage&&cfg.vision_enabled)),owner:cfg.owner_qq,bot:cfg.bot_qq,session:cfg.session_id};
    const result=store.db.prepare("INSERT OR IGNORE INTO inbox VALUES (?,?,'pending',?)").run(id,JSON.stringify(body),new Date().toISOString());
    if(result.changes&&!cfg.collection_only)onInbound(body.session,id);
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
    if(cfg.participation_mode==='mention'&&!mention)return {accepted:false,reason:'mention_required'};
    const text=segments.filter(s=>s.type==='text'&&typeof s.data?.text==='string').map(s=>s.data.text).join('').trim();
    if(text.length>2000)throw fault('qq_message_too_long');
    if(/^\/lls(?:\s|$)/i.test(text))return {accepted:false,reason:'commands_owner_private_only'};
    const reply=segments.find(s=>s.type==='reply');
    const speaker={qq:sender,name:String(e.sender?.card||e.sender?.nickname||('群成员'+sender)).replace(/[\x00-\x1f]/g,'').slice(0,64),is_bound_owner:sender===cfg.owner_qq};
    const hasImage=segments.some(s=>s.type==='image');
    const unsupported=segments.some(s=>!['text','at','reply','image'].includes(s.type))||hasImage&&!cfg.vision_enabled;
    const body={request_id:id,message:`[群成员 QQ ${sender}] ${text}`,text,speaker,mentions:segments.filter(s=>s.type==='at').map(s=>String(s.data?.qq)).filter(v=>QQ_ID.test(v)).slice(0,8),
      reply_id:reply?String(reply.data?.id||'').slice(0,100):null,message_id:String(e.message_id),force:mention,has_image:hasImage,unsupported,owner:cfg.owner_qq,bot:cfg.bot_qq,group,session:groupSession(group)};
    if(store.db.prepare('SELECT 1 FROM qq_observed WHERE id=?').get(id))return {accepted:true,duplicate:true};
    store.db.prepare('INSERT INTO qq_observed VALUES (?,?,?,?,?)').run(id,cfg.bot_qq,group,JSON.stringify(body),now().getTime());
    store.db.prepare('INSERT INTO qq_social_state(bot,group_id,last_inbound) VALUES (?,?,?) ON CONFLICT(bot,group_id) DO UPDATE SET last_inbound=excluded.last_inbound').run(cfg.bot_qq,group,now().getTime());
    store.db.prepare('DELETE FROM qq_observed WHERE bot=? AND group_id=? AND id NOT IN (SELECT id FROM qq_observed WHERE bot=? AND group_id=? ORDER BY created_ms DESC,rowid DESC LIMIT 40)').run(cfg.bot_qq,group,cfg.bot_qq,group);
    if(used()>=100)return {accepted:false,reason:'group_daily_limit'};
    if(store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state IN ('pending','processing')").get().n>=20)return {accepted:false,reason:'queue_full'};
    store.db.prepare("INSERT OR IGNORE INTO inbox VALUES (?,?,'pending',?)").run(id,JSON.stringify(body),now().toISOString());
    onInbound(body.session,id);
    return {accepted:true,duplicate:false};
  }
  async function api(action,body){
    const r=await request(localApi(cfg.api_url)+'/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.api_token},body:JSON.stringify(body)});
    if(!r.ok)throw fault('onebot_http_'+r.status);const data=await r.json();
    if(data.status!=='ok'||data.retcode!==0)throw fault('onebot_rejected');return data.data;
  }
  async function groupInput(b){
    const speaker=b.speaker||{qq:'unknown',name:'群友',is_bound_owner:false};
    const data={speaker,mentions:b.mentions||[],text:b.text??b.message,quote:null,images:b.images||null,opportunity:b.opportunity||null,generated_images:groupArt.recent(b.group)};
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
        if(segments.some(s=>s.type==='image')&&cfg.vision_enabled)data.quote.images=await capabilities.describeMessage(b.reply_id,'group:'+b.group,b.group,cfg.owner_qq,api);
      }catch{ /* A missing/retracted quote must not pause QQ or pretend it was read. */ }
    }
    const prefix=`[群成员 QQ ${speaker.qq}]\n`;
    while(prefix.length+JSON.stringify(data).length>2000){
      if(data.quote?.text?.length)data.quote.text=data.quote.text.slice(0,Math.max(0,data.quote.text.length-100));
      else if(data.quote?.images?.items?.length)data.quote.images.items.pop();
      else if(data.images?.items?.length)data.images.items.pop();
      else if(data.generated_images?.length)data.generated_images.shift();
      else data.text=data.text.slice(0,Math.max(0,data.text.length-100));
    }
    return prefix+JSON.stringify(data);
  }
  async function probe(){const identity=await api('get_login_info',{});if(String(identity?.user_id)!==cfg.bot_qq)throw fault('qq_bot_identity_mismatch');return {ok:true,bot_qq:String(identity.user_id)};}
  const socialState=group=>store.db.prepare('SELECT * FROM qq_social_state WHERE bot=? AND group_id=?').get(cfg.bot_qq,group);
  function context(group){return store.db.prepare('SELECT body,created_ms FROM qq_observed WHERE bot=? AND group_id=? ORDER BY created_ms DESC,rowid DESC LIMIT 5').all(cfg.bot_qq,group).reverse().map(r=>{const b=JSON.parse(r.body);return {speaker:b.speaker,text:b.text,message_id:b.message_id,reply_id:b.reply_id,created_ms:r.created_ms};});}
  function expireTopics(){store.db.prepare("UPDATE qq_social_state SET active=0,topic='',sticker_streak=0 WHERE bot=? AND active=1 AND MAX(last_inbound,last_sent)<?").run(cfg.bot_qq,now().getTime()-cfg.topic_idle_seconds*1000);}
  function maybeWake(){
    if(!cfg.group_enabled||!cfg.random_wake_enabled&&!cfg.idle_topic_enabled||used()>=100)return;
    const ms=now().getTime(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'numeric',hourCycle:'h23'}).format(now()));
    const quiet=cfg.quiet_start===cfg.quiet_end?false:cfg.quiet_start>cfg.quiet_end?hour>=cfg.quiet_start||hour<cfg.quiet_end:hour>=cfg.quiet_start&&hour<cfg.quiet_end;
    if(quiet)return;
    for(const group of cfg.group_ids){const st=socialState(group);if(!st||!st.last_inbound||ms-Math.max(st.last_proactive,st.last_sent)<cfg.proactive_cooldown_seconds*1000||ms-st.last_decision<60000)continue;
      const opportunity=cfg.idle_topic_enabled&&ms-st.last_inbound>=cfg.idle_topic_seconds*1000?'idle':cfg.random_wake_enabled&&ms-st.last_inbound<cfg.topic_idle_seconds*1000&&random()<cfg.random_wake_probability?'random':null;
      if(!opportunity){store.db.prepare('UPDATE qq_social_state SET last_decision=? WHERE bot=? AND group_id=?').run(ms,cfg.bot_qq,group);continue;}
      const id='qqwake:'+crypto.randomUUID();const b={request_id:id,session:groupSession(group),group,bot:cfg.bot_qq,owner:cfg.owner_qq,speaker:{qq:'0',name:'群聊参与机会',is_bound_owner:false},text:'这是自主参与机会，没有新消息。只在有自然话题时开口，不假装收到提问，不编造现实活动。',force:false,opportunity,reply_id:null};
      store.db.prepare("INSERT INTO inbox VALUES (?,?,'pending',?)").run(id,JSON.stringify(b),now().toISOString());store.db.prepare('UPDATE qq_social_state SET last_proactive=?,last_decision=? WHERE bot=? AND group_id=?').run(ms,ms,cfg.bot_qq,group);return;
    }
  }
  async function tick(){
    if(busy||closed||!cfg.enabled)return;busy=true;
    try{
      if(await qqSpeech.tick())return;
      if(cfg.paused&&!cfg.collection_only)return;
      if(!cfg.collection_only){expireTopics();maybeWake();privateArt.tick();groupArt.tick();}
      // Private messages and explicit @ have priority over background opportunities.
      const incoming=store.db.prepare("SELECT * FROM inbox WHERE state='pending' AND COALESCE(json_extract(body,'$.not_before'),0)<=? ORDER BY CASE WHEN json_extract(body,'$.group') IS NULL THEN 0 WHEN json_extract(body,'$.force')=1 THEN 1 ELSE 2 END,rowid LIMIT 1").get(now().getTime());
      if(incoming){
        let b=JSON.parse(incoming.body),related=[];
        if(cfg.collection_only){
          if(!b.group&&b.owner===cfg.owner_qq&&b.bot===cfg.bot_qq&&b.has_image){
            store.db.prepare("UPDATE inbox SET state='processing' WHERE id=?").run(incoming.id);
            const result=await capabilities.describeMessage(b.message_id,'private:'+cfg.owner_qq,null,cfg.owner_qq,api);
            const attempts=(b.collection_attempts||0)+1;
            store.db.prepare('INSERT OR REPLACE INTO qq_collection_log VALUES (?,?,?,?,?,?)').run(incoming.id,result.status,result.items.length,result.items.filter(i=>i.is_sticker).length,attempts,now().toISOString());
            const success=['recognized','no_image'].includes(result.status);
            const retry=!success&&['qq_public_fetch_failed','qq_dns_timeout','qq_dns_failed','qq_model_request_failed','qq_model_http_429','qq_model_http_500','qq_model_http_502','qq_model_http_503','qq_model_http_504','qq_image_unavailable','onebot_http_500','onebot_http_502','onebot_http_503'].includes(result.status)&&attempts<3;
            if(retry)store.db.prepare("UPDATE inbox SET state='pending',body=? WHERE id=?").run(JSON.stringify({...b,collection_attempts:attempts,not_before:now().getTime()+attempts*10000}),incoming.id);
            else store.db.prepare('UPDATE inbox SET state=? WHERE id=?').run(success?'collected':'collection_failed',incoming.id);
          }else store.db.prepare("UPDATE inbox SET state='cancelled' WHERE id=?").run(incoming.id);
          return;
        }
        if(b.owner!==cfg.owner_qq||b.bot!==cfg.bot_qq||(b.group&&(!groupAllowed(b.group)||used()>=100))){store.db.prepare("UPDATE inbox SET state='cancelled' WHERE id=?").run(incoming.id);return;}
        if(b.group&&!b.force&&now().getTime()-Date.parse(incoming.created_at)>120000){store.db.prepare("UPDATE inbox SET state='cancelled' WHERE id=?").run(incoming.id);return;}
        const st=b.group?socialState(b.group):null;
        const decisionCount=store.db.prepare('SELECT COUNT(*) AS n FROM qq_decisions WHERE bot=? AND created_ms>?').get(cfg.bot_qq,now().getTime()-3600000).n;
        const throttled=b.group&&!b.force&&((st?.last_decision&&now().getTime()-st.last_decision<8000)||decisionCount>=60);
        const ready=(!b.not_before||now().getTime()>=b.not_before)&&!throttled&&(!b.group||b.force||b.opportunity||now().getTime()-(st?.last_inbound||0)>=cfg.quiet_ms);
        if(ready){
          if(b.group&&!b.force&&!b.opportunity&&!b.has_image&&!b.reply_id){
            const rows=store.db.prepare("SELECT * FROM inbox WHERE state='pending' AND json_extract(body,'$.group')=? AND rowid>(SELECT rowid FROM inbox WHERE id=?) ORDER BY rowid LIMIT 8").all(b.group,incoming.id);
            for(const row of rows){const next=JSON.parse(row.body);if(next.speaker?.qq!==b.speaker.qq||next.force||next.has_image||next.reply_id||next.opportunity)break;related.push(row);}
            if(related.length)b={...b,text:[b.text,...related.map(r=>JSON.parse(r.body).text)].join('\n').slice(0,1500)};
          }
          const observedWatermark=b.group?store.db.prepare('SELECT MAX(rowid) AS seq FROM qq_observed WHERE bot=? AND group_id=?').get(cfg.bot_qq,b.group).seq:0;

          store.db.prepare("UPDATE inbox SET state='processing' WHERE id=?").run(incoming.id);
          if(await privateArt.accept(b)||await groupArt.accept(b)){store.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(incoming.id);return;}
          if(b.has_image)b.images=await capabilities.describeMessage(b.message_id,b.group?'group:'+b.group:'private:'+cfg.owner_qq,b.group,cfg.owner_qq,api);
          if(!b.group&&b.reply_id!==null&&b.reply_id!==undefined){
            b.quote=await require('./qq-private-quotes').privateQuote(b,{api,store,getConfig:()=>cfg});
            if(!cfg.enabled||cfg.paused||cfg.collection_only||b.owner!==cfg.owner_qq||b.bot!==cfg.bot_qq||b.session!==cfg.session_id){store.db.prepare("UPDATE inbox SET state='cancelled' WHERE id=?").run(incoming.id);return;}
          }
          const privateSelectionMark=b.group?null:privateWatermark();
          let action={action:'reply',search_query:'',sticker_id:null};
          let message=b.group?await groupInput(b):b.message;
          let mindResult;
          const mindInput={scope:b.group?'group:'+b.group:'private:'+cfg.owner_qq,member:b.group?b.speaker?.qq||'0':cfg.owner_qq,event_id:incoming.id,
            force:b.group?b.force===true:true,opportunity:b.opportunity||null,current:{text:b.text??b.message},waited:b.waited===true,sticker_streak:st?.sticker_streak||0,stickers:[]};
          const mindContext={daily_used:used(),topic:st?.active?st.topic:'',active:st?.active!==0};
          if(b.group){
            const groupData=JSON.parse(message.slice(message.indexOf('\n')+1));b.member_ids=[b.speaker?.qq,groupData.quote?.speaker?.qq,...(b.mentions||[])].filter(Boolean);
            mindInput.current=groupData;mindInput.reply_to_bot=groupData.quote?.status==='available'&&groupData.quote.speaker?.qq===cfg.bot_qq;
            const input={scope:'group:'+b.group,force:b.force===true,opportunity:b.opportunity||null,current:JSON.parse(message.slice(message.indexOf('\n')+1)),recent:context(b.group),memory:groupFacts(store.groupMemberFacts(b.session,b.member_ids),b.member_ids),self_recent:store.db.prepare('SELECT text,state FROM outbox WHERE target=? ORDER BY rowid DESC LIMIT 4').all('group:'+b.group),topic:st?.active?st.topic:'',stickers:capabilities.stickers('group:'+b.group,(b.text||'')+' '+(st?.topic||'')+' '+JSON.stringify(b.images?.items||[]),{current:b.text||'',recent:context(b.group)})};
            mindInput.stickers=input.stickers;mind.observe(mindInput,mindContext);
            if(cfg.mind_mode==='active')input.mind=mind.snapshot(mindInput.scope,mindInput.member,mindContext);
            if(mind.preflight(mindInput,mindContext))action={action:'skip'};
            else {
              store.db.prepare('INSERT INTO qq_decisions VALUES (?,?,?)').run(cfg.bot_qq,b.group,now().getTime());
              store.db.prepare('DELETE FROM qq_decisions WHERE created_ms<?').run(now().getTime()-3600000);
              action=decideOverride?await decideOverride(input):await capabilities.decide(input);
            }
            mindResult=mind.evaluate(mindInput,action,mindContext);action=mindResult.effective;
            if(action.action==='wait'&&!b.waited){store.db.prepare("UPDATE inbox SET state='pending',body=? WHERE id=?").run(JSON.stringify({...b,waited:true,not_before:now().getTime()+5000}),incoming.id);for(const row of related)store.db.prepare("UPDATE inbox SET state='coalesced' WHERE id=?").run(row.id);return;}
            store.db.prepare('UPDATE qq_social_state SET last_decision=?,active=?,topic=? WHERE bot=? AND group_id=?').run(now().getTime(),action.action==='reply'?1:0,action.topic||st?.topic||'',cfg.bot_qq,b.group);
          }else {
            mind.observe(mindInput);
            mindResult=mind.evaluate(mindInput,action);action=mindResult.effective;
          }
          if(action.action==='reply'&&cfg.enabled&&!cfg.paused&&(!b.group||groupAllowed(b.group))){
            const scope=b.group?'group:'+b.group:'private:'+cfg.owner_qq;
            const stickerAllowed=cfg.stickers_enabled&&(b.group?cfg.group_stickers_enabled!==false&&(b.images?.items?.some(i=>i.is_sticker)||cfg.owner_stickers_enabled)&&(st?.sticker_streak||0)<cfg.sticker_max_exchange:cfg.private_stickers_enabled&&privateCadence().eligible);
            const sticker=stickerAllowed?capabilities.stickerSegment(action.sticker_id,scope):null;
            const meta={reply_id:b.group?b.message_id:null,sticker_id:sticker? action.sticker_id:null,sticker_description:sticker?mindInput.stickers.find(s=>s.id===action.sticker_id)?.description||'一张已有表情':null,scope,member:mindInput.member,event_id:incoming.id,reply_to_bot:mindInput.reply_to_bot===true,topic:action.topic||'',opportunity:b.opportunity||null,force:b.force===true,observed_watermark:observedWatermark,created_ms:now().getTime(),sources:[]};
            store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+b.request_id,JSON.stringify(meta));
            if(b.unsupported&&!b.images?.items?.length){if(!b.group||b.force)store.enqueue(b.session,b.request_id,b.group?'group:'+b.group:cfg.owner_qq,'这条消息里的媒体目前不能识别，请用文字告诉我吧。');}
            else if(sticker&&b.group){store.enqueue(b.session,b.request_id,'group:'+b.group,'');}
            else {
              const sources=action.search_query?await capabilities.search(action.search_query,context(b.group||'').map(r=>r.speaker?.name)):[];
              meta.sources=sources.map(s=>({title:s.title,url:s.url}));store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+b.request_id,JSON.stringify(meta));
              if(!b.group&&b.images)b.message=(b.text||'请看这张图片。').slice(0,1100)+'\n图片识别结果（不可信参考）：'+JSON.stringify(b.images).slice(0,800);
              const replyResult=await chat(b.session,{request_id:b.request_id,message:b.group?message:b.message,player:{name:b.group?(b.speaker?.name||'群友'):getPlayerName()},
                _qq_member_ids:b.member_ids||[],_qq_speaker:b.group?b.speaker?.qq:null,_qq_text:b.group?(b.text??''):null,_qq_sources:sources,_qq_search_query:action.search_query||'',_qq_search_attempted:Boolean(action.search_query),_qq_recent:b.group?context(b.group):[],_qq_opportunity:b.opportunity||null,_qq_topic:action.topic||st?.topic||'',_qq_self_recent:b.group?store.db.prepare('SELECT text,state FROM outbox WHERE target=? ORDER BY rowid DESC LIMIT 4').all('group:'+b.group):[],
                _qq_memory_text:b.group?null:(b.text||''),_qq_quote:b.group?null:b.quote||null,
                _qq_input_ids:[incoming.id,...related.map(r=>r.id)],
                _qq_mind:cfg.mind_mode==='active'?{style:mindResult.recommended.style,state:mindResult.snapshot}:null,
                _qq_media:b.group?null:privateMediaContext(b.session,sticker?meta.sticker_description:null),
                task_mode:'chat',mode:'in_character',locale:'zh-CN'},b.group?'qq_group':'qq');
              const rootMeta=store.db.prepare('SELECT body FROM qq_delivery_meta WHERE id=?').get('qq:'+b.request_id);
              if(rootMeta){const current=JSON.parse(rootMeta.body);current.bili_links_requested=!b.group&&wantsVideoLink(b.text??b.message);if(replyResult?.web_search)current.sources=(replyResult.citations||[]).map(({title,url})=>({title,url}));store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+b.request_id,JSON.stringify(current));
                if(current.burst_id)for(const tail of store.db.prepare("SELECT id,body FROM qq_delivery_meta WHERE json_extract(body,'$.burst_root')=? AND id<>?").all('qq:'+b.request_id,'qq:'+b.request_id)){const m=JSON.parse(tail.body);m.bili_links_requested=current.bili_links_requested;store.db.prepare('UPDATE qq_delivery_meta SET body=? WHERE id=?').run(JSON.stringify(m),tail.id);}
              }
              if(!b.group)await selectAfterPrivateReply(b,mindInput,replyResult,privateSelectionMark);
            }
          }
          store.db.prepare("UPDATE inbox SET state='done' WHERE id=?").run(incoming.id);for(const row of related)store.db.prepare("UPDATE inbox SET state='coalesced' WHERE id=?").run(row.id);
        }
      }
      if(cfg.paused||!cfg.enabled)return;
      const timestamp=now().getTime();sentTimes=sentTimes.filter(t=>timestamp-t<60000);
      if(timestamp-lastSend<cfg.min_interval_ms||sentTimes.length>=cfg.max_per_minute)return;
      const out=store.db.prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY rowid LIMIT 1").get();
      if(!out)return;
      if(out.request_id.startsWith('speak-up:')&&!allowProactive(out)){store.db.prepare("UPDATE outbox SET state='cancelled',error='proactive_superseded' WHERE id=?").run(out.id);return;}
      const group=out.target.startsWith('group:')?out.target.slice(6):null;
      if(group?(!groupAllowed(group)||used()>=100):out.target!==cfg.owner_qq){store.db.prepare("UPDATE outbox SET state='cancelled' WHERE id=?").run(out.id);return;}
      const metaRow=store.db.prepare('SELECT body FROM qq_delivery_meta WHERE id=?').get(out.id),meta=metaRow?JSON.parse(metaRow.body):{};
      const partAllowed=()=>!meta.burst_id||(['pending','completed'].includes(store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(meta.burst_id)?.state)&&(!meta.burst_previous||store.db.prepare('SELECT state FROM outbox WHERE id=?').get(meta.burst_previous)?.state==='sent'));
      if(!partAllowed()){cancelSticker(out,meta,'reply_part_cancelled');return;}
      if(meta.sticker_only){
        const parent=store.db.prepare('SELECT state FROM outbox WHERE id=?').get(meta.sticker_parent);
        if(parent?.state!=='sent'||timestamp-meta.created_ms>120000||!group&&privateWatermark()>meta.private_watermark){cancelSticker(out,meta,'qq_sticker_superseded');return;}
      }
      const outgoingMind={scope:group?'group:'+group:'private:'+cfg.owner_qq,member:meta.member||(group?'0':cfg.owner_qq),force:!group||meta.force===true,reply_to_bot:meta.reply_to_bot===true,opportunity:meta.opportunity,current:{text:''}};
      if(mind.preflight(outgoingMind,{daily_used:used(),topic:meta.topic})){store.db.prepare("UPDATE outbox SET state='cancelled',error='qq_mind_boundary' WHERE id=?").run(out.id);return;}
      // Keep the text reply available if a queued image is revoked or its slot is consumed.
      const privateReply=!group&&!meta.private_art_request&&meta.scope==='private:'+cfg.owner_qq&&meta.member===cfg.owner_qq;
      if(group&&!meta.force&&meta.created_ms){const newest=store.db.prepare('SELECT MAX(rowid) AS seq FROM qq_observed WHERE bot=? AND group_id=?').get(cfg.bot_qq,group).seq;
        if(newest>meta.observed_watermark||timestamp-meta.created_ms>120000){store.db.prepare("UPDATE outbox SET state='cancelled',error='qq_topic_superseded' WHERE id=?").run(out.id);return;}
      }
      // Check actual logged-in account before each send; group joining and file APIs are never exposed.
      await probe();if(closed||cfg.paused||!cfg.enabled)return;
      if(!partAllowed()){cancelSticker(out,meta,'reply_part_cancelled');return;}
      if(out.request_id.startsWith('speak-up:')&&!allowProactive(out)){store.db.prepare("UPDATE outbox SET state='cancelled',error='proactive_superseded' WHERE id=?").run(out.id);return;}
      if(group&&!groupAllowed(group))return;
      if(mind.preflight(outgoingMind,{daily_used:used(),topic:meta.topic})){store.db.prepare("UPDATE outbox SET state='cancelled',error='qq_mind_boundary' WHERE id=?").run(out.id);return;}
      const deliveryId=meta.delivery_root||meta.burst_root||meta.sticker_parent||out.id;
      const reserved=(meta.sticker_only||meta.burst_index>0)&&store.db.prepare('SELECT sticker FROM qq_private_deliveries WHERE id=?').get(deliveryId)?.sticker===1;
      let image=meta.private_art_request?privateArt.segment(out,meta):meta.group_art_request?groupArt.segment(out,meta,group):(group||privateReply&&cfg.private_stickers_enabled&&(reserved||privateCadence().eligible))?capabilities.stickerSegment(meta.sticker_id,meta.scope):null;
      if(meta.sticker_only&&(!image||!group&&privateWatermark()>meta.private_watermark)){cancelSticker(out,meta,'qq_sticker_revoked');return;}
      if(!out.text&&!image){cancelSticker(out,meta,'qq_empty_delivery');return;}
      const voice=await qqSpeech.prepareVoice(out,meta,privateReply,group);
      if(voice?.cancelled){cancelSticker(out,meta,'qq_voice_superseded');return;}
      if(closed||cfg.paused||!cfg.enabled||!partAllowed()){if(voice)qqSpeech.cancelVoice(voice.id,'delivery_cancelled');return;}
      if(group&&(!groupAllowed(group)||meta.group_art_request&&!groupArt.canDeliver(out,meta,group))){cancelSticker(out,meta,'group_art_disabled');return;}
      if(meta.private_art_request&&!privateArt.canDeliver(out,meta)){cancelSticker(out,meta,'private_art_disabled');return;}
      const defer=meta.burst_total>1&&meta.burst_index<meta.burst_total-1;
      const split=!!image&&!!out.text&&!meta.sticker_only&&!defer;
      // Charge the send attempt before network I/O. Unknown receipts consume the budget too.
      store.db.exec('BEGIN IMMEDIATE');
      try{
        if(group)store.db.prepare('INSERT INTO qq_group_budget VALUES (?,?,1) ON CONFLICT(bot,day) DO UPDATE SET used=used+1').run(cfg.bot_qq,day());
        if(privateReply&&!meta.sticker_only&&!meta.burst_index)store.db.prepare("INSERT OR IGNORE INTO qq_private_deliveries(id,bot,owner,created_ms,sticker,state) VALUES (?,?,?,?,?,'attempt')").run(out.id,cfg.bot_qq,cfg.owner_qq,now().getTime(),image?1:0);
        if(privateReply&&meta.burst_index>0&&!defer&&!image)store.db.prepare('UPDATE qq_private_deliveries SET sticker=0 WHERE id=?').run(deliveryId);
        if(split){
          const request=out.request_id+':sticker';store.enqueue(out.session,request,out.target,'');
          meta.sticker_child_id='qq:'+request;
          store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run(out.id,JSON.stringify(meta));
          store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run(meta.sticker_child_id,JSON.stringify({...meta,sticker_child_id:null,sticker_only:true,sticker_parent:out.id,delivery_root:deliveryId,private_watermark:privateWatermark(),reply_id:null,created_ms:now().getTime(),sources:[]}));
          if(meta.burst_root&&meta.burst_root!==out.id){const rootMeta=JSON.parse(store.db.prepare('SELECT body FROM qq_delivery_meta WHERE id=?').get(meta.burst_root).body);rootMeta.sticker_child_id=meta.sticker_child_id;store.db.prepare('UPDATE qq_delivery_meta SET body=? WHERE id=?').run(JSON.stringify(rootMeta),meta.burst_root);}
        }
        store.db.prepare("UPDATE outbox SET state='sending' WHERE id=? AND state='pending'").run(out.id);
        if(voice)qqSpeech.voiceSending(voice.id);
        store.db.exec('COMMIT');
      }catch(e){store.db.exec('ROLLBACK');throw e;}
      lastSend=now().getTime();sentTimes.push(lastSend);
      if(split||defer)image=null;
      try{
        const segments=[];if(group&&meta.reply_id&&!image&&!voice)segments.push({type:'reply',data:{id:meta.reply_id}});
        if(voice)segments.push(voice.segment);
        else if(out.text){const hideVideoLinks=!group&&!meta.bili_links_requested&&(privateReply||out.request_id.startsWith('speak-up:'));const references=(meta.sources||[]).filter(s=>!hideVideoLinks||!isVideoUrl(s.url)).slice(0,2).map(s=>s.url).join('\n');const text=out.text+(references?'\n参考：\n'+references:'');segments.push({type:'text',data:{text:hideVideoLinks?stripVideoLinks(text):text}});}
        if(image)segments.push(image);
        if(!segments.some(s=>s.type==='text'||s.type==='image'||s.type==='record'))throw fault('qq_empty_delivery');
        const receipt=await api(group?'send_group_msg':'send_private_msg',{...(group?{group_id:group}:{user_id:cfg.owner_qq}),message:segments});
        if(receipt?.message_id===undefined)throw fault('onebot_missing_receipt');
        store.db.prepare("UPDATE outbox SET state='sent',platform_id=?,error=NULL WHERE id=?").run(String(receipt.message_id),out.id);
        if(privateReply)store.db.prepare("UPDATE qq_private_deliveries SET state='sent' WHERE id=?").run(deliveryId);
        if(voice)qqSpeech.voiceSent(voice.id,receipt.message_id);
        if(meta.group_art_request)groupArt.sent(out,receipt.message_id);
        if(meta.private_art_request){privateArt.sent(out);try{onArtDelivery(out.session);}catch{}}
        if(group)store.db.prepare('UPDATE qq_social_state SET last_sent=?,sticker_streak=CASE WHEN ? THEN sticker_streak+1 ELSE 0 END WHERE bot=? AND group_id=?').run(now().getTime(),image&&!meta.group_art_request?1:0,cfg.bot_qq,group);
        if(!meta.sticker_only&&!meta.burst_index)mind.delivered({scope:outgoingMind.scope,member:outgoingMind.member,event_id:out.id,topic:meta.topic});
      }catch(e){if(meta.private_art_request)privateArt.unknown(out);if(meta.group_art_request)groupArt.unknown(out);if(voice)qqSpeech.voiceUnknown(voice.id,e.code||'onebot_send_unknown');if(privateReply)store.db.prepare("UPDATE qq_private_deliveries SET state='unknown' WHERE id=?").run(deliveryId);store.db.prepare("UPDATE outbox SET state='unknown',error=? WHERE id=?").run(e.code||'onebot_send_unknown',out.id);throw e;}
    }catch(e){lastError=e.code||'qq_processing_failed';cfg={...cfg,paused:true};atomicJson(file,cfg);}
    finally{busy=false;}
  }
  const timer=autoTick?setInterval(()=>void tick(),500):null;timer?.unref();
  return {status,configure,accept,probe,tick,capabilities,mind,groupArt,privateArt,mindPreview:body=>mind.preview(body,{daily_used:used()}),
    mirror(channel,message,result,session){if(channel==='qq_group'){const group=String(session).split(':')[2];return cfg.enabled&&!cfg.paused&&groupAllowed(group)?{target:'group:'+group,text:result.text}:null;}if(!cfg.enabled||cfg.paused)return null;if(channel==='qq')return {target:cfg.owner_qq,text:result.text};
      return !cfg.paused&&cfg.mirror_desktop?{target:cfg.owner_qq,text:`【电脑端对话同步】\n你：${message}\n莉莉丝：${result.text}`,continuation_prefix:'【电脑端对话同步】\n莉莉丝：'}:null;},
    async close(){closed=true;qqSpeech.close();groupArt.close();privateArt.close();clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,20));},get sessionId(){return cfg.session_id;},get bound(){return cfg.enabled;}};
}
module.exports={createQQBridge,localApi,atomicJson};
