'use strict';
// Semantic safety precedes variety. Counters describe candidate exposure and
// confirmed image receipts, never familiarity or extra permission to send.
const crypto=require('node:crypto');
const VERSION='2026.10.27.1';
function intentFor({current='',reply='',recent=[]}={}){
 const text=String(current||''),answer=String(reply||''),sleep=/晚安|哄.{0,4}睡|睡前|睡觉|该睡|去睡|睡吧|睡不着|安心睡|好好睡|入睡|困了|好困|闭.{0,3}眼|盖.{0,3}被|做个好梦|梦里|枕头/;
 if(sleep.test(answer)||sleep.test(text))return 'bedtime';
 if(text.length<=18&&!/工作|代码|游戏|新闻|股|基金|吓|惊|意外|中了|开心|成功/.test(text)&&recent.slice(-6).some(r=>sleep.test(r.text||r.content||'')))return 'bedtime';
 return 'general';
}
function semanticAllowed(description,categories=[],intent='general'){
 if(intent!=='bedtime')return true;
 if(categories.some(k=>['surprised','angry','sad','baka','_laugh','_stock','_red','_green','work'].includes(k)))return false;
 if(/惊讶|惊恐|惊愕|震惊|惊吓|害怕|尖叫|大叫|张大嘴|愤怒|生气|欺负|打闹|骑压|嘲讽|大笑|蹦|雀跃|兴奋|哭泣|落泪|大哭|伤感|无奈|困惑/.test(description))return false;
 return categories.includes('sleep')||/困倦|睡|晚安|温柔|轻柔|安静|安心|闭眼|微笑|拥抱|抱抱/.test(description);
}
function createStickerSelection({store,getConfig,now=Date.now}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS qq_sticker_exposure(bot TEXT,scope TEXT,asset TEXT,shown INTEGER NOT NULL,last_shown INTEGER NOT NULL,PRIMARY KEY(bot,scope,asset));
 CREATE TABLE IF NOT EXISTS qq_sticker_selection_audit(id TEXT PRIMARY KEY,bot TEXT,scope TEXT,intent TEXT,candidates INTEGER,chosen TEXT,result TEXT,created_ms INTEGER);`);
 function permitted(scope){const c=getConfig();return scope==='private:'+c.owner_qq||String(scope).startsWith('group:')&&c.group_enabled&&(c.group_ids||[]).includes(scope.slice(6));}
 function history(scope){
  if(!permitted(scope))return [];
  const c=getConfig();if(!c.bot_qq||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='qq_private_deliveries'").get())return [];const group=scope.startsWith('group:'),session=group?`qq-group:${c.bot_qq}:${scope.slice(6)}`:(c.session_id||'desktop-pet');
  return db.prepare(`SELECT o.id,o.created_at,m.body,d.bot FROM outbox o JOIN qq_delivery_meta m ON m.id=o.id
   LEFT JOIN qq_private_deliveries d ON d.id=COALESCE(json_extract(m.body,'$.delivery_root'),json_extract(m.body,'$.burst_root'),json_extract(m.body,'$.sticker_parent'),o.id)
   WHERE o.session=? AND json_extract(m.body,'$.scope')=? AND o.state='sent' AND o.platform_id IS NOT NULL AND json_extract(m.body,'$.sticker_id') IS NOT NULL
   AND (json_extract(m.body,'$.sticker_only')=1 OR o.text='' OR (d.sticker=1 AND json_extract(m.body,'$.sticker_child_id') IS NULL AND COALESCE(json_extract(m.body,'$.burst_total'),1)=1))
   AND json_extract(m.body,'$.group_art_request') IS NULL ORDER BY o.rowid DESC LIMIT 128`).all(session,scope).filter(r=>group||r.bot===c.bot_qq).map(r=>({id:JSON.parse(r.body).sticker_id,at:r.created_at}));
 }
 function rank(rows,scope,limit=20,{repeat=false}={}){
  const c=getConfig(),receipts=history(scope),uses=new Map(),exposure=new Map(db.prepare('SELECT asset,shown,last_shown FROM qq_sticker_exposure WHERE bot=? AND scope=?').all(String(c.bot_qq||'unbound'),scope).map(r=>[r.asset,r]));
  receipts.forEach((r,i)=>{const u=uses.get(r.id)||{confirmed_sends:0,recent_sends:0,last_sent_at:r.at,last_index:i};u.confirmed_sends++;if(i<8)u.recent_sends++;uses.set(r.id,u);});
  const max=Math.max(0,...rows.map(r=>r.score));
  const enriched=rows.map(r=>{const u=uses.get(r.id)||{confirmed_sends:0,recent_sends:0,last_sent_at:null,last_index:Infinity},e=exposure.get(r.id);return {...r,band:r.score>0?(r.score>=max-1?2:1):0,usage:{confirmed_sends:u.confirmed_sends,recent_sends:u.recent_sends,last_sent_at:u.last_sent_at,shown_count:e?.shown||0},cooldown:u.last_index<2?1:0,last_shown:e?.last_shown||0};});
  const freshness=(a,b)=>a.cooldown-b.cooldown||a.usage.recent_sends-b.usage.recent_sends||a.usage.confirmed_sends-b.usage.confirmed_sends||a.usage.shown_count-b.usage.shown_count||a.last_shown-b.last_shown;
  const primary=[...enriched].sort((a,b)=>b.band-a.band||freshness(a,b)||b.score-a.score||b.preference-a.preference||a.id.localeCompare(b.id));
  const previous=repeat&&receipts.length?primary.find(r=>r.id===receipts[0].id):null;
  const selected=[...(previous?[previous]:[]),...primary.filter(r=>r.score>0&&r!==previous).slice(0,previous?11:12)],ids=new Set(selected.map(r=>r.id));
  const rest=enriched.filter(r=>!ids.has(r.id)).sort((a,b)=>b.band-a.band||freshness(a,b)||b.score-a.score||b.preference-a.preference||a.id.localeCompare(b.id));
  // This rotates equally suitable candidates; never fill outside the semantic
  // filter or replace the model's choice with a random picture.
  for(const row of rest){if(selected.length>=limit)break;selected.push(row);}
  return selected.slice(0,limit).map(({id,description,source,usage})=>({id,description,source,usage}));
 }
 function exposed(scope,rows){if(!permitted(scope)||!getConfig().bot_qq)return;const bot=getConfig().bot_qq,at=now();db.exec('BEGIN IMMEDIATE');try{for(const r of rows)db.prepare('INSERT INTO qq_sticker_exposure VALUES (?,?,?,1,?) ON CONFLICT(bot,scope,asset) DO UPDATE SET shown=shown+1,last_shown=excluded.last_shown').run(bot,scope,r.id,at);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 function audit(scope,intent,candidates,chosen,result){if(!permitted(scope)||!getConfig().bot_qq)return;const bot=getConfig().bot_qq;db.prepare('INSERT INTO qq_sticker_selection_audit VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),bot,scope,intent,candidates,chosen||null,result,now());db.prepare('DELETE FROM qq_sticker_selection_audit WHERE bot=? AND rowid NOT IN (SELECT rowid FROM qq_sticker_selection_audit WHERE bot=? ORDER BY rowid DESC LIMIT 500)').run(bot,bot);}
 return {rank,exposed,audit,history,status:()=>({sticker_selection_version:VERSION,sticker_selection_policy:'meaning_then_variety',sticker_selection_timing:'after_private_reply'})};
}
module.exports={VERSION,intentFor,semanticAllowed,createStickerSelection};
