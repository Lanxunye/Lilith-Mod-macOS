'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {parseDrawingRequest}=require('./qq-group-art');
function privateMention(segments,text,bot){
 if(segments.some(s=>s.type==='at'&&String(s.data?.qq)===bot))return {force:true,text};
 // Some QQ friend clients transmit typed @ as text instead of an at segment.
 const match=String(text).match(new RegExp('^@(?:莉莉丝|Lilith|'+bot+')[\\s，,:：]+([\\s\\S]+)$','i'));
 return {force:!!match,text:match?match[1].trim():text};
}
function createQQPrivateArt({store,getConfig,artwork,now,respond}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS qq_private_art_jobs(request_id TEXT PRIMARY KEY,bot TEXT,owner TEXT,session TEXT,state TEXT,job_id TEXT,outbox_id TEXT,scene TEXT,error TEXT,created_ms INTEGER)`);
 store.db.prepare("UPDATE qq_private_art_jobs SET state='unknown',error='submission_interrupted' WHERE state='reserving'").run();let closed=false;
 const allowed=row=>{const c=getConfig();return !!row&&!closed&&c.enabled&&!c.paused&&!c.collection_only&&c.private_art_enabled&&row.bot===c.bot_qq&&row.owner===c.owner_qq&&row.session===c.session_id;};
 function cancelReply(row){store.db.prepare("UPDATE outbox SET state='cancelled',error='private_art_disabled' WHERE state='pending' AND (id=? OR id=?)").run('qq:'+row.request_id,row.outbox_id||'');for(const b of store.db.prepare("SELECT id FROM reply_batches WHERE session=? AND request_id=? AND state='pending'").all(row.session,row.request_id))store.cancelBatch(b.id,'private_art_disabled');}
 function notice(b,text){const input={message:b.message,channel:'qq',private_art:true};if(!store.begin(b.session,b.request_id,input))store.commit(b.session,b.request_id,b.message,{text,status:'ok',ui:{emotion:'neutral',animation:'listen'}},'qq','host-private-art',{target:b.owner,text});}
 async function accept(b){
  if(b.group||b.force!==true)return false;const action=parseDrawingRequest(b.drawing_text??b.text);if(!action)return false;
  const c=getConfig();if(closed||!c.enabled||c.paused||c.collection_only||b.bot!==c.bot_qq||b.owner!==c.owner_qq||b.session!==c.session_id)return false;
  if(store.db.prepare('SELECT 1 FROM qq_private_art_jobs WHERE request_id=?').get(b.request_id))return true;
  if(!c.private_art_enabled){notice(b,'私聊绘图目前已关闭。使用 /lls pdraw on 可以开启。');return true;}
  if(b.has_image||b.unsupported){notice(b,'这次请直接 @ 我并用文字描述画面，暂不依赖附件或引用图片。');return true;}
  if(!artwork){notice(b,'画室暂时不可用，这次没有提交绘图。');return true;}
  store.db.prepare("INSERT INTO qq_private_art_jobs VALUES (?,?,?,?,'reserving',NULL,NULL,?,NULL,?)").run(b.request_id,c.bot_qq,c.owner_qq,b.session,action.scene,now().getTime());
  let job;
  try{job=artwork.submit(action,{source:'qq_private',sessionId:b.session,requestId:'qqprivate-art:'+crypto.createHash('sha256').update(b.request_id).digest('hex'),authorizePrivate:()=>{const row=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE request_id=?').get(b.request_id);return allowed(row)&&row.state==='reserving';},canContinue:()=>{const row=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE request_id=?').get(b.request_id);return allowed(row)&&row.state==='rendering';}});}
  catch(e){store.db.prepare("UPDATE qq_private_art_jobs SET state='rejected',error=? WHERE request_id=?").run(e.code||'art_submit_failed',b.request_id);notice(b,e.code==='art_busy'?'这张还在画，让我先画完它。稍后再 @ 我说下一张吧。':'这次没能开始绘图，主人可以检查控制台的画室状态。');return true;}
  store.db.prepare("UPDATE qq_private_art_jobs SET state='rendering',job_id=? WHERE request_id=?").run(job.id,b.request_id);
  if(respond)await respond(b);else notice(b,'这幅图让我来画，稍等一下。');
  const current=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE request_id=?').get(b.request_id);if(!allowed(current)||current.state==='cancelled')cancelReply(current||b);
  return true;
 }
 function cancelPending(){for(const row of store.db.prepare("SELECT * FROM qq_private_art_jobs WHERE state IN ('reserving','rendering','ready')").all())cancelReply(row);store.db.prepare("UPDATE qq_private_art_jobs SET state='cancelled',error='private_art_disabled' WHERE state IN ('reserving','rendering','ready')").run();}
 function tick(){
  if(closed)return;for(const row of store.db.prepare("SELECT * FROM qq_private_art_jobs WHERE state IN ('rendering','ready')").all()){
   if(!allowed(row)){cancelReply(row);store.db.prepare("UPDATE qq_private_art_jobs SET state='cancelled',error='private_art_disabled' WHERE request_id=?").run(row.request_id);continue;}
   if(row.state==='ready'){const out=store.db.prepare('SELECT state FROM outbox WHERE id=?').get(row.outbox_id);if(out&&['sent','unknown','cancelled'].includes(out.state))store.db.prepare('UPDATE qq_private_art_jobs SET state=? WHERE request_id=?').run(out.state,row.request_id);continue;}
   let job;try{job=artwork.get(row.job_id);}catch{job={status:'failed',error:'art_job_unavailable'};}
   if(job.status==='failed'){
    store.db.prepare("UPDATE qq_private_art_jobs SET state='failed',error=? WHERE request_id=?").run(job.error||'art_generation_failed',row.request_id);
    const text=job.error==='art_quality_rejected'?'这次没画准，先不给你一张画错的图。':job.error?.startsWith('art_scene_')?'这次还没把画面设计好，先不硬画。':job.error?.startsWith('art_review_')?'这张图暂时没能完成核对，先不发出。':'这张图没能画完，主人可以检查画室状态。';store.enqueue(row.session,row.request_id+':art-error',row.owner,text);continue;
   }
   if(job.status!=='completed')continue;
   const request=row.request_id+':art-image',outbox='qq:'+request;store.db.exec('BEGIN IMMEDIATE');try{
    store.enqueue(row.session,request,row.owner,'');store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run(outbox,JSON.stringify({private_art_request:row.request_id,scope:'private:'+row.owner,member:row.owner,force:true,created_ms:now().getTime(),sources:[]}));store.db.prepare("UPDATE qq_private_art_jobs SET state='ready',outbox_id=? WHERE request_id=?").run(outbox,row.request_id);store.db.exec('COMMIT');
   }catch(e){store.db.exec('ROLLBACK');throw e;}
  }
 }
 function canDeliver(out,meta){const row=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE request_id=?').get(meta.private_art_request);return allowed(row)&&row.state==='ready'&&row.outbox_id===out.id&&row.owner===out.target&&row.session===out.session?row:null;}
 function segment(out,meta){const row=canDeliver(out,meta);if(!row)return null;try{const job=artwork.get(row.job_id);if(job.status!=='completed')return null;const bytes=fs.readFileSync(artwork.asset(row.job_id));if(bytes.length>12*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||crypto.createHash('sha256').update(bytes).digest('hex')!==job.image_sha256)return null;return {type:'image',data:{file:'base64://'+bytes.toString('base64'),sub_type:0,summary:'[莉莉丝绘图]'}};}catch{return null;}}
 function sent(out){const row=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE outbox_id=?').get(out.id);if(!row)return;store.db.prepare("UPDATE qq_private_art_jobs SET state='sent',error=NULL WHERE request_id=?").run(row.request_id);store.db.prepare("INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,'qq','assistant',?,?,'host-private-art')").run(row.session+':'+row.request_id+':art-delivery',row.session,row.request_id,'【绘图已发送并收到平台回执】'+row.scene,now().toISOString());}
 function unknown(out){store.db.prepare("UPDATE qq_private_art_jobs SET state='unknown',error='delivery_unknown' WHERE outbox_id=?").run(out.id);}
 function feedback(request,session){const row=store.db.prepare('SELECT * FROM qq_private_art_jobs WHERE request_id=? AND session=?').get(request,session);return allowed(row)&&['rendering','ready','sent'].includes(row.state)?{state:row.state,scene:row.scene,image_delivered:row.state==='sent'}:null;}
 function recent(){const c=getConfig();return store.db.prepare('SELECT scene,state,error,job_id FROM qq_private_art_jobs WHERE bot=? AND owner=? AND session=? ORDER BY created_ms DESC,rowid DESC LIMIT 3').all(c.bot_qq,c.owner_qq,c.session_id).map(({job_id,...row})=>{let review;try{review=artwork?.get(job_id)?.attempts?.at(-1)?.review;}catch{}return {...row,visually_checked:review?.passed===true,visual_description:review?.passed===true?String(review.observations||'').slice(0,450):''};});}
 return {accept,tick,segment,canDeliver,sent,unknown,feedback,recent,cancelPending,close(){closed=true;},status:()=>({private_art_enabled:getConfig().private_art_enabled,private_art_available:!!artwork,private_art_daily_limit:null,private_art_trigger:'explicit_mention',private_art_pending:store.db.prepare("SELECT COUNT(*) AS n FROM qq_private_art_jobs WHERE state IN ('reserving','rendering','ready')").get().n})};
}
module.exports={createQQPrivateArt,privateMention};
