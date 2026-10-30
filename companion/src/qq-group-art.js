'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const LIMIT=10;
function parseDrawingRequest(text){
 text=String(text||'').trim();
 if(!text||text.length>1400||/(?:不要|别|不用|无需|停止|关闭).{0,12}(?:画|绘|生图|生成)/.test(text))return null;
 if(!/(?:^\/draw\s+|画(?:一[张幅个]|张|幅|个|一下|出)|(?:请|帮我|给我|为我).{0,8}画|生图|绘制|生成.{0,10}(?:图|画))/i.test(text))return null;
 return {kind:'illustration',scene:text.replace(/^\/draw\s+/i,'').trim(),mood:'gentle',caption:'',reason:'群成员明确 @ 请求绘图'};
}
function createQQGroupArt({store,getConfig,artwork,now,day,groupAllowed,respond}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS qq_group_art_jobs(
 request_id TEXT PRIMARY KEY,bot TEXT,owner TEXT,group_id TEXT,session TEXT,day TEXT,
 state TEXT,job_id TEXT,outbox_id TEXT,scene TEXT,error TEXT,created_ms INTEGER)`);
 // A crash between reservation and submission cannot safely be retried.
 store.db.prepare("UPDATE qq_group_art_jobs SET state='unknown',error='submission_interrupted' WHERE state='reserving'").run();
 let closed=false;
 const used=group=>store.db.prepare("SELECT COUNT(*) AS n FROM qq_group_art_jobs WHERE bot=? AND day=? AND group_id=? AND state<>'rejected'").get(getConfig().bot_qq,day(),group).n;
 const allowed=b=>{const c=getConfig();return !closed&&c.enabled&&!c.paused&&!c.collection_only&&c.group_art_enabled&&b.bot===c.bot_qq&&b.owner===c.owner_qq&&b.day===day()&&groupAllowed(b.group_id);};
 function notice(b,text){
  const id=b.request_id,input={message:b.message||b.text,channel:'qq_group',group_art:true};
  if(!store.begin(b.session,id,input))store.commit(b.session,id,input.message,{text,status:'ok',ui:{emotion:'neutral',animation:'listen'}},'qq_group','host-group-art',{target:'group:'+b.group,text});
  store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+id,JSON.stringify({scope:'group:'+b.group,member:b.speaker?.qq||'0',force:true,reply_id:b.message_id,created_ms:now().getTime(),sources:[]}));
 }
 async function accept(b){
  const action=b.group&&b.force===true&&!b.opportunity?parseDrawingRequest(b.text):null;
  if(!action)return false;
  const config=getConfig();if(closed||!config.enabled||config.paused||config.collection_only||config.bot_qq!==b.bot||config.owner_qq!==b.owner||!groupAllowed(b.group))return false;
  if(store.db.prepare('SELECT 1 FROM qq_group_art_jobs WHERE request_id=?').get(b.request_id))return true;
  if(b.has_image||b.unsupported||b.reply_id){notice(b,'群聊生图目前只按本条文字描述绘制。请直接 @ 我并描述画面，不依赖附件或引用图片。');return true;}
  if(!getConfig().group_art_enabled){notice(b,'群聊生图目前已关闭。主人可在私聊使用 /lls draw on 开启。');return true;}
  if(!artwork){notice(b,'本地画室暂不可用，这次没有提交绘图。');return true;}
  if(used(b.group)>=LIMIT){notice(b,'本群今天生图已达到 10 张上限，明天北京时间零点后再画吧。');return true;}
  const c=getConfig();
  store.db.exec('BEGIN IMMEDIATE');
  try{
   if(used(b.group)>=LIMIT){store.db.exec('ROLLBACK');notice(b,'本群今天生图已达到 10 张上限。');return true;}
   store.db.prepare("INSERT INTO qq_group_art_jobs VALUES (?,?,?,?,?,?,'reserving',NULL,NULL,?,NULL,?)").run(b.request_id,c.bot_qq,c.owner_qq,b.group,b.session,day(),action.scene,now().getTime());store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  let job;
  try{
   job=artwork.submit(action,{source:'qq_group',sessionId:b.session,requestId:'qqgroup-art:'+crypto.createHash('sha256').update(b.request_id).digest('hex'),authorizeGroup:()=>{
    const row=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE request_id=?').get(b.request_id);return row?.state==='reserving'&&allowed(row)&&used(b.group)<=LIMIT;
   },canContinue:()=>{const row=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE request_id=?').get(b.request_id);return !!row&&row.state==='rendering'&&allowed(row);}});
  }catch(e){
   store.db.prepare("UPDATE qq_group_art_jobs SET state='rejected',error=? WHERE request_id=?").run(e.code||'art_submit_failed',b.request_id);
   notice(b,e.code==='art_busy'?'本地画室正在绘制其他图片，这次没有排入，请稍后重新 @ 我请求。':'这次未能提交本地绘图，请主人检查控制台的画室状态。');
   return true;
  }
  store.db.prepare("UPDATE qq_group_art_jobs SET state='rendering',job_id=? WHERE request_id=?").run(job.id,b.request_id);
  if(respond)await respond(b);
  else notice(b,'好，这幅图让我来画。稍等一下。');
  const current=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE request_id=?').get(b.request_id);
  if(!allowed(current)||current.state==='cancelled'){
   store.db.prepare("UPDATE outbox SET state='cancelled',error='group_art_disabled' WHERE id=? AND state='pending'").run('qq:'+b.request_id);
   for(const batch of store.db.prepare("SELECT id FROM reply_batches WHERE session=? AND request_id=? AND state='pending'").all(b.session,b.request_id))store.cancelBatch(batch.id,'group_art_disabled');
  }
  return true;
 }
 function cancelPending(){
  store.db.prepare("UPDATE outbox SET state='cancelled',error='group_art_disabled' WHERE state='pending' AND id IN (SELECT outbox_id FROM qq_group_art_jobs WHERE state='ready')").run();
  store.db.prepare("UPDATE qq_group_art_jobs SET state='cancelled',error='group_art_disabled' WHERE state IN ('reserving','rendering','ready')").run();
 }
 function tick(){
  if(closed)return;
  const jobs=store.db.prepare("SELECT * FROM qq_group_art_jobs WHERE state IN ('rendering','ready')").all();
  for(const row of jobs){
   if(!allowed(row)){if(row.outbox_id)store.db.prepare("UPDATE outbox SET state='cancelled',error='group_art_disabled' WHERE id=? AND state='pending'").run(row.outbox_id);store.db.prepare("UPDATE qq_group_art_jobs SET state='cancelled',error='group_art_disabled' WHERE request_id=?").run(row.request_id);continue;}
   if(row.state==='ready'){
    const out=store.db.prepare('SELECT state FROM outbox WHERE id=?').get(row.outbox_id);
    if(out&&['sent','unknown','cancelled'].includes(out.state))store.db.prepare('UPDATE qq_group_art_jobs SET state=? WHERE request_id=?').run(out.state,row.request_id);
    continue;
   }
   let job;try{job=artwork.get(row.job_id);}catch{job={status:'failed',error:'art_job_unavailable'};}
   if(job.status==='failed'){
    store.db.prepare("UPDATE qq_group_art_jobs SET state='failed',error=? WHERE request_id=?").run(job.error||'art_generation_failed',row.request_id);
    const request=row.request_id+':art-error';
    const reason=job.error==='art_quality_rejected'?'这次的画面没画准，这张先不发，免得给你一张不合要求的图。':job.error?.startsWith('art_scene_')?'这次还没把画面设计好，先不硬画。':job.error?.startsWith('art_review_')?'这张图暂时没能完成核对，先不发出。主人可以检查控制台的识图服务。':'这张图未能完成，请主人检查本地画室。';
    store.enqueue(row.session,request,'group:'+row.group_id,reason);
    store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+request,JSON.stringify({force:true,scope:'group:'+row.group_id,created_ms:now().getTime(),sources:[]}));continue;
   }
   if(job.status!=='completed')continue;
   const request=row.request_id+':art-image',outbox='qq:'+request;
   store.db.exec('BEGIN IMMEDIATE');try{
    store.enqueue(row.session,request,'group:'+row.group_id,'');
    store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run(outbox,JSON.stringify({group_art_request:row.request_id,scope:'group:'+row.group_id,force:true,created_ms:now().getTime(),sources:[]}));
    store.db.prepare("UPDATE qq_group_art_jobs SET state='ready',outbox_id=? WHERE request_id=?").run(outbox,row.request_id);store.db.exec('COMMIT');
   }catch(e){store.db.exec('ROLLBACK');throw e;}
  }
 }
 function canDeliver(out,meta,group){const row=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE request_id=?').get(meta.group_art_request);return row&&row.state==='ready'&&row.outbox_id===out.id&&row.group_id===group&&row.session===out.session&&allowed(row)?row:null;}
 function segment(out,meta,group){
  const row=canDeliver(out,meta,group);if(!row)return null;
  try{const job=artwork.get(row.job_id);if(job.status!=='completed')return null;const bytes=fs.readFileSync(artwork.asset(row.job_id));
   if(bytes.length>12*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||crypto.createHash('sha256').update(bytes).digest('hex')!==job.image_sha256)return null;
   return {type:'image',data:{file:'base64://'+bytes.toString('base64'),sub_type:0,summary:'[莉莉丝绘图]'}};
  }catch{return null;}
 }
 function sent(out,receipt){const row=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE outbox_id=?').get(out.id);if(!row)return;
  store.db.prepare("UPDATE qq_group_art_jobs SET state='sent',error=NULL WHERE request_id=?").run(row.request_id);
  store.db.prepare("INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,'qq_group','assistant',?,?,'host-group-art')").run(row.session+':'+row.request_id+':art-delivery',row.session,row.request_id,'【绘图已发送并收到平台回执】'+row.scene,now().toISOString());
 }
 function unknown(out){store.db.prepare("UPDATE qq_group_art_jobs SET state='unknown',error='delivery_unknown' WHERE outbox_id=?").run(out.id);}
 function feedback(request,session){const row=store.db.prepare('SELECT * FROM qq_group_art_jobs WHERE request_id=? AND session=?').get(request,session);if(!row||!allowed(row)||!['rendering','ready','sent'].includes(row.state))return null;
  return {state:row.state,scene:row.scene,image_delivered:row.state==='sent'};
 }
 return {accept,tick,segment,canDeliver,sent,unknown,feedback,cancelPending,close(){closed=true;},
  status:()=>{const groups=(getConfig().group_ids||[]).map(group_id=>({group_id,used:used(group_id),limit:LIMIT}));return {group_art_enabled:getConfig().group_art_enabled,group_art_available:!!artwork,group_art_budget_scope:'per_group',group_art_daily_limit:LIMIT,group_art_daily_used:groups.reduce((n,g)=>n+g.used,0),group_art_groups:groups,group_art_timezone:'Asia/Shanghai',group_art_day:day(),group_art_pending:store.db.prepare("SELECT COUNT(*) AS n FROM qq_group_art_jobs WHERE state IN ('reserving','rendering','ready')").get().n};},
  recent:group=>store.db.prepare('SELECT scene,state,error,job_id FROM qq_group_art_jobs WHERE bot=? AND group_id=? ORDER BY created_ms DESC LIMIT 3').all(getConfig().bot_qq,group).map(({job_id,...row})=>{
    let review;try{review=artwork?.get(job_id)?.attempts?.at(-1)?.review;}catch{}
    return {...row,visually_checked:review?.passed===true,visual_description:review?.passed===true?String(review.observations||'').slice(0,450):''};
  })};
}
module.exports={createQQGroupArt,parseDrawingRequest};
