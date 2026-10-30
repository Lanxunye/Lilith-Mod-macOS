'use strict';
// One durable journal for both channels. Recent JSON files are compatibility projections only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
function fault(code) { return Object.assign(new Error(code), {code}); }
class ConversationStore {
  constructor(root) {
    fs.mkdirSync(root, {recursive:true,mode:0o700});
    const file=path.join(root,'conversations.sqlite');
    this.db=new DatabaseSync(file); fs.chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns (session TEXT, request_id TEXT, fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, result TEXT, PRIMARY KEY(session,request_id));
      CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
        session TEXT NOT NULL,request_id TEXT NOT NULL,channel TEXT NOT NULL,role TEXT NOT NULL,
        content TEXT NOT NULL,created_at TEXT NOT NULL,persona_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS summaries (id INTEGER PRIMARY KEY,session TEXT NOT NULL,
        first_seq INTEGER NOT NULL,last_seq INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facts (owner TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,
        source_id TEXT NOT NULL,evidence TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,key));
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,session TEXT NOT NULL,request_id TEXT NOT NULL,
        target TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,platform_id TEXT,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY,body TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proactive_meta (id TEXT PRIMARY KEY,owner_seq INTEGER,owner_signal INTEGER,revision INTEGER,created_ms INTEGER);
      CREATE TABLE IF NOT EXISTS reply_batches (id TEXT PRIMARY KEY,session TEXT,request_id TEXT,channel TEXT,persona_hash TEXT,parts TEXT,mirror TEXT,next_index INTEGER,next_at INTEGER,state TEXT,created_ms INTEGER);
      CREATE TABLE IF NOT EXISTS reply_parts (message_id TEXT PRIMARY KEY,body TEXT);
      CREATE TABLE IF NOT EXISTS qq_delivery_meta (id TEXT PRIMARY KEY,body TEXT);
      CREATE INDEX IF NOT EXISTS message_session_seq ON messages(session,seq);`);
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('owner_id',?)").run(crypto.randomUUID());
    this.db.exec("UPDATE turns SET state='interrupted' WHERE state='processing'; UPDATE outbox SET state='unknown',error='process_interrupted' WHERE state='sending'; UPDATE inbox SET state='pending' WHERE state='processing'");
    this.queues=new Map();
    // Interrupted bursts are never resumed into a different conversation.
    for(const row of this.db.prepare("SELECT id FROM reply_batches WHERE state='pending' OR id IN (SELECT json_extract(body,'$.burst_id') FROM qq_delivery_meta WHERE id IN (SELECT id FROM outbox WHERE state='pending'))").all())this.cancelBatch(row.id,'process_interrupted');
  }
  get ownerId(){return this.db.prepare("SELECT value FROM meta WHERE key='owner_id'").get().value;}
  serial(session,fn){
    const previous=this.queues.get(session)||Promise.resolve();
    const next=previous.catch(()=>{}).then(fn);this.queues.set(session,next);
    return next.finally(()=>{if(this.queues.get(session)===next)this.queues.delete(session);});
  }
  begin(session,id,body){
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const old=this.db.prepare('SELECT * FROM turns WHERE session=? AND request_id=?').get(session,id);
    if(old){if(old.fingerprint!==fingerprint)throw fault('request_id_conflict');
      if(old.state==='done')return JSON.parse(old.result);
      throw fault('request_interrupted');}
    this.db.prepare("INSERT INTO turns VALUES (?,?,?,'processing',NULL)").run(session,id,fingerprint);return null;
  }
  commit(session,id,message,result,channel,personaHash,mirror=null,memory=null,delivery=null){
    const now=new Date().toISOString();this.db.exec('BEGIN IMMEDIATE');
    try{
      const insert=this.db.prepare('INSERT INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)');
      for(const [role,text] of [['user',message],['assistant',result.text]])
        insert.run(`${session}:${id}:${role}`,session,id,channel,role,String(text||''),now,personaHash);
      this.db.prepare("UPDATE turns SET state='done',result=? WHERE session=? AND request_id=?").run(JSON.stringify(result),session,id);
      if(memory)this.factUpdates(memory.updates,session,id,message,memory.sensitive);
      if(mirror)this.enqueue(session,id,mirror.target,mirror.text);
      if(delivery)this.stageParts(session,id,channel,personaHash,delivery);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  appendAssistant(session,id,text){this.db.prepare('INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)').run(`${session}:${id}`,session,id,'desktop','assistant',text,new Date().toISOString(),'system');}
  commitProactive(session,id,result,personaHash,target=null,meta=null,delivery=null){
    const request='speak-up:'+id;this.db.exec('BEGIN IMMEDIATE');
    try{const exists=this.db.prepare('SELECT 1 FROM messages WHERE id=?').get(`${session}:${request}:assistant`);
      if(!exists){this.db.prepare('INSERT INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(`${session}:${request}:assistant`,session,request,'proactive','assistant',result.text,new Date().toISOString(),personaHash);
        if(target)this.enqueue(session,request,target,result.text);
        if(meta)this.db.prepare('INSERT INTO proactive_meta VALUES (?,?,?,?,?)').run('qq:'+request,meta.owner_seq,meta.owner_signal,meta.revision,meta.created_ms);
        if(delivery)this.stageParts(session,request,'proactive',personaHash,delivery);}
      this.db.exec('COMMIT');return !exists;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  stageParts(session,request,channel,personaHash,d){
    this.db.prepare("INSERT INTO reply_batches VALUES (?,?,?,?,?,?,?,?,?,'pending',?)").run(d.id,session,request,channel,personaHash,JSON.stringify(d.parts),JSON.stringify(d.mirror),1,d.next_at,d.created_ms);
    const meta={batch_id:d.id,parent_request:request,index:0,total:d.parts.length,...d.parts[0]};delete meta.text;
    this.db.prepare('INSERT INTO reply_parts VALUES (?,?)').run(`${session}:${request}:assistant`,JSON.stringify(meta));
    if(d.mirror){const key='qq:'+request,existing=this.db.prepare('SELECT body FROM qq_delivery_meta WHERE id=?').get(key),old=existing?JSON.parse(existing.body):{};
      this.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run(key,JSON.stringify({...old,burst_id:d.id,burst_index:0,burst_total:d.parts.length,burst_root:key}));}
  }
  cancelBatch(id,reason='new_message'){
    this.db.prepare("UPDATE reply_batches SET state='cancelled' WHERE id=?").run(id);
    this.db.prepare("UPDATE outbox SET state='cancelled',error=? WHERE state='pending' AND id IN (SELECT id FROM qq_delivery_meta WHERE json_extract(body,'$.burst_id')=?)").run(reason,id);
  }
  cancelReplyParts(session,exceptRequest=''){
    // Include completed local batches: a slow QQ queue may still have unsent parts.
    for(const row of this.db.prepare("SELECT id FROM reply_batches WHERE session=? AND request_id<>? AND state<>'cancelled'").all(session,exceptRequest))this.cancelBatch(row.id);
  }
  deliverPart(batch,now){
    const {partDelay}=require('./reply-parts'),parts=JSON.parse(batch.parts),i=batch.next_index,part=parts[i],request=batch.request_id+':part:'+i;
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare('INSERT INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(`${batch.session}:${request}:assistant`,batch.session,request,batch.channel,'assistant',part.text,new Date(now).toISOString(),batch.persona_hash);
      const meta={batch_id:batch.id,parent_request:batch.request_id,index:i,total:parts.length,...part};delete meta.text;
      this.db.prepare('INSERT INTO reply_parts VALUES (?,?)').run(`${batch.session}:${request}:assistant`,JSON.stringify(meta));
      const mirror=JSON.parse(batch.mirror);
      if(mirror){const key='qq:'+request,root='qq:'+batch.request_id,old=JSON.parse(this.db.prepare('SELECT body FROM qq_delivery_meta WHERE id=?').get(root)?.body||'{}');
        this.enqueue(batch.session,request,mirror.target,(mirror.continuation_prefix||'')+part.text);
        this.db.prepare('INSERT INTO qq_delivery_meta VALUES (?,?)').run(key,JSON.stringify({...old,burst_index:i,burst_previous:i===1?root:root+':part:'+(i-1),reply_id:null,sources:[]}));
        const proactive=this.db.prepare('SELECT * FROM proactive_meta WHERE id=?').get(root);
        if(proactive)this.db.prepare('INSERT INTO proactive_meta VALUES (?,?,?,?,?)').run(key,proactive.owner_seq,proactive.owner_signal,proactive.revision,proactive.created_ms);
      }
      this.db.prepare('UPDATE reply_batches SET next_index=?,next_at=?,state=? WHERE id=?').run(i+1,now+partDelay(part),i+1===parts.length?'completed':'pending',batch.id);
      this.db.exec('COMMIT');return part;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  withParts(rows){return rows.map(row=>{const part=this.db.prepare('SELECT body FROM reply_parts WHERE message_id=?').get(row.id);if(!part)return row;const meta=JSON.parse(part.body);return {...row,reply_part:{...meta,state:this.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(meta.batch_id)?.state}};});}
  interrupt(session,id){this.db.prepare("UPDATE turns SET state='interrupted' WHERE session=? AND request_id=? AND state='processing'").run(session,id);}
  importHistory(session,history){
    if(this.db.prepare('SELECT 1 FROM messages WHERE session=? LIMIT 1').get(session))return;
    this.db.exec('BEGIN IMMEDIATE');
    try{const insert=this.db.prepare('INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)');
      history.forEach((m,i)=>insert.run(`legacy:${session}:${i}`,session,m.task_delivery_id?'dsh:'+m.task_delivery_id:'legacy','desktop',m.role==='assistant'?'assistant':'user',String(m.content||''),m.created_at||new Date().toISOString(),'legacy'));
      this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  floor(session){return Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('session_floor:'+session)?.value||0);}
  messages(session,after=0,limit=100){return this.withParts(this.db.prepare('SELECT * FROM messages WHERE session=? AND seq>? ORDER BY seq LIMIT ?').all(session,Math.max(after,this.floor(session)),Math.min(500,limit)));}
  recent(session,limit=24){return this.withParts(this.db.prepare('SELECT * FROM messages WHERE session=? AND seq>? ORDER BY seq DESC LIMIT ?').all(session,this.floor(session),limit).reverse()).map(row=>({...row,...(row.request_id.startsWith('dsh:')?{task_delivery_id:row.request_id.slice(4)}:{})}));}
  summaries(session){return this.db.prepare('SELECT * FROM summaries WHERE session=? ORDER BY last_seq DESC LIMIT 6').all(session).reverse().map(s=>({...s,body:JSON.parse(s.body)}));}
  pendingSummary(session,keep=24,batch=32){
    const floor=Number(this.db.prepare("SELECT value FROM meta WHERE key='summary_floor'").get()?.value||0);
    const last=Math.max(floor,this.floor(session),this.db.prepare('SELECT MAX(last_seq) AS seq FROM summaries WHERE session=?').get(session).seq||0);
    const recent=this.recent(session,keep);if(!recent.length)return [];
    return this.db.prepare('SELECT * FROM messages WHERE session=? AND seq>? AND seq<? ORDER BY seq LIMIT ?').all(session,last,recent[0].seq,batch);
  }
  saveSummary(session,rows,items){
    // Model chooses salient *verbatim* excerpts. Reject invented evidence and store exact provenance.
    const verified=[];
    for(const item of (Array.isArray(items)?items:[]).slice(0,8)){
      const row=rows.find(r=>r.id===item.source_id);const quote=String(item.quote||'');
      if(row&&quote.length>=2&&quote.length<=240&&row.content.includes(quote)){
        const excerpt={source_id:row.id,role:row.role,quote};
        if(session.startsWith('qq-group:')){
          const parent=JSON.parse(this.db.prepare('SELECT body FROM reply_parts WHERE message_id=?').get(row.id)?.body||'{}').parent_request;
          const user=row.role==='user'?row:this.db.prepare("SELECT content FROM messages WHERE session=? AND request_id=? AND role='user'").get(session,parent||row.request_id);
          const speaker=user?.content.match(/^\[群成员 QQ (\d+)\]/)?.[1];
          if(speaker)excerpt[row.role==='user'?'speaker_qq':'reply_to_qq']=speaker;
        }
        verified.push(excerpt);
      }
    }
    if(!verified.length)throw fault('summary_without_evidence');
    this.db.prepare('INSERT INTO summaries(session,first_seq,last_seq,body,created_at) VALUES (?,?,?,?,?)')
      .run(session,rows[0].seq,rows.at(-1).seq,JSON.stringify(verified),new Date().toISOString());return verified;
  }
  factUpdates(updates,session,id,userMessage,sensitive){
    for(const u of (updates||[]).slice(0,6)){
      const key=String(u.key||'').trim().slice(0,session.startsWith('qq-group:')?64:24),value=String(u.value||'').trim().slice(0,100),evidence=String(u.evidence||'');
      if(!key||!value||!evidence||!userMessage.includes(evidence)||sensitive(key,value))continue;
      this.db.prepare('INSERT OR REPLACE INTO facts VALUES (?,?,?,?,?,?)').run(this.ownerId+':'+session,key,value,`${session}:${id}:user`,evidence,new Date().toISOString());
    }
  }
  facts(session){return this.db.prepare('SELECT * FROM facts WHERE owner=? ORDER BY updated_at DESC LIMIT 50').all(this.ownerId+':'+session).reverse();}
  groupMemberFacts(session,memberIds=[]){
    if(!String(session).startsWith('qq-group:'))return [];
    const ids=[...new Set((Array.isArray(memberIds)?memberIds:[]).map(String).filter(id=>/^[1-9]\d{4,19}$/.test(id)))].slice(0,10);
    if(!ids.length)return this.facts(session);
    return this.db.prepare('SELECT * FROM facts WHERE owner=? AND ('+ids.map(()=> 'key LIKE ?').join(' OR ')+') ORDER BY updated_at DESC LIMIT 40')
      .all(this.ownerId+':'+session,...ids.map(id=>id+':%')).reverse();
  }
  clearDerived(){this.db.exec("DELETE FROM facts; DELETE FROM summaries; INSERT OR REPLACE INTO meta SELECT 'summary_floor',CAST(COALESCE(MAX(seq),0) AS TEXT) FROM messages");}
  memoryCandidates(){
    // Only existing reviewed excerpts/facts, verified against their original
    // private user rows. Assistant guesses and group member statements stay out.
    const rows=[];
    const ownerText=content=>String(content).split('\n图片识别结果（不可信参考）：')[0];
    const facts=this.db.prepare(`SELECT f.*,m.content,m.created_at,m.channel,m.role,m.session,m.persona_hash FROM facts f JOIN messages m ON m.id=f.source_id
      WHERE m.role='user' AND m.channel IN ('desktop','qq') AND m.session NOT LIKE 'qq-group:%'`).all();
    for(const f of facts)if(f.owner===this.ownerId+':'+f.session&&f.evidence&&ownerText(f.content).includes(f.evidence))
      rows.push({kind:'fact',key:f.key,quote:f.evidence,source_id:f.source_id,at:f.created_at,time_unknown:f.persona_hash==='legacy'});
    const summaries=this.db.prepare("SELECT * FROM summaries WHERE session NOT LIKE 'qq-group:%'").all();
    const source=this.db.prepare("SELECT * FROM messages WHERE id=? AND session=? AND role='user' AND channel IN ('desktop','qq')");
    for(const s of summaries)for(const x of JSON.parse(s.body)){
      if(x.role!=='user'||!x.quote)continue;const m=source.get(x.source_id,s.session);
      if(m&&m.seq>this.floor(s.session)&&ownerText(m.content).includes(x.quote))rows.push({kind:'event',quote:x.quote,source_id:m.id,at:m.created_at,time_unknown:m.persona_hash==='legacy'});
    }
    return rows;
  }
  reset(session){
    this.cancelReplyParts(session);
    this.db.exec('BEGIN IMMEDIATE');try{
      const last=this.db.prepare('SELECT MAX(seq) AS seq FROM messages WHERE session=?').get(session).seq||0;
      this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('session_floor:'+session,String(last));
      this.db.prepare('DELETE FROM summaries WHERE session=?').run(session);
      this.db.prepare("UPDATE outbox SET state='cancelled' WHERE session=? AND state='pending'").run(session);
      this.db.prepare("UPDATE inbox SET state='cancelled' WHERE state='pending' AND json_extract(body,'$.session')=?").run(session);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  enqueue(session,id,target,text){this.db.prepare("INSERT OR IGNORE INTO outbox(id,session,request_id,target,text,state,created_at) VALUES (?,?,?,?,?,'pending',?)").run(`qq:${id}`,session,id,target,text,new Date().toISOString());}
  outbox(){return this.db.prepare('SELECT id,state,platform_id,error,created_at FROM outbox ORDER BY created_at DESC LIMIT 100').all();}
  close(){this.db.close();}
}
module.exports={ConversationStore,fault};
