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
      CREATE INDEX IF NOT EXISTS message_session_seq ON messages(session,seq);`);
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('owner_id',?)").run(crypto.randomUUID());
    this.db.exec("UPDATE turns SET state='interrupted' WHERE state='processing'; UPDATE outbox SET state='unknown',error='process_interrupted' WHERE state='sending'; UPDATE inbox SET state='pending' WHERE state='processing'");
    this.queues=new Map();
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
  commit(session,id,message,result,channel,personaHash,mirror=null,memory=null){
    const now=new Date().toISOString();this.db.exec('BEGIN IMMEDIATE');
    try{
      const insert=this.db.prepare('INSERT INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)');
      for(const [role,text] of [['user',message],['assistant',result.text]])
        insert.run(`${session}:${id}:${role}`,session,id,channel,role,String(text||''),now,personaHash);
      this.db.prepare("UPDATE turns SET state='done',result=? WHERE session=? AND request_id=?").run(JSON.stringify(result),session,id);
      if(memory)this.factUpdates(memory.updates,session,id,message,memory.sensitive);
      if(mirror)this.enqueue(session,id,mirror.target,mirror.text);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  appendAssistant(session,id,text){this.db.prepare('INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)').run(`${session}:${id}`,session,id,'desktop','assistant',text,new Date().toISOString(),'system');}
  interrupt(session,id){this.db.prepare("UPDATE turns SET state='interrupted' WHERE session=? AND request_id=? AND state='processing'").run(session,id);}
  importHistory(session,history){
    if(this.db.prepare('SELECT 1 FROM messages WHERE session=? LIMIT 1').get(session))return;
    this.db.exec('BEGIN IMMEDIATE');
    try{const insert=this.db.prepare('INSERT OR IGNORE INTO messages(id,session,request_id,channel,role,content,created_at,persona_hash) VALUES (?,?,?,?,?,?,?,?)');
      history.forEach((m,i)=>insert.run(`legacy:${session}:${i}`,session,m.task_delivery_id?'dsh:'+m.task_delivery_id:'legacy','desktop',m.role==='assistant'?'assistant':'user',String(m.content||''),m.created_at||new Date().toISOString(),'legacy'));
      this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  floor(session){return Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('session_floor:'+session)?.value||0);}
  messages(session,after=0,limit=100){return this.db.prepare('SELECT * FROM messages WHERE session=? AND seq>? ORDER BY seq LIMIT ?').all(session,Math.max(after,this.floor(session)),Math.min(500,limit));}
  recent(session,limit=24){return this.db.prepare('SELECT * FROM messages WHERE session=? AND seq>? ORDER BY seq DESC LIMIT ?').all(session,this.floor(session),limit).reverse().map(row=>({...row,...(row.request_id.startsWith('dsh:')?{task_delivery_id:row.request_id.slice(4)}:{})}));}
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
          const user=row.role==='user'?row:this.db.prepare("SELECT content FROM messages WHERE session=? AND request_id=? AND role='user'").get(session,row.request_id);
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
  clearDerived(){this.db.exec("DELETE FROM facts; DELETE FROM summaries; INSERT OR REPLACE INTO meta SELECT 'summary_floor',CAST(COALESCE(MAX(seq),0) AS TEXT) FROM messages");}
  reset(session){
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
