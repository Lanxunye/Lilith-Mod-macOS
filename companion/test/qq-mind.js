'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store');
const {createQQMind,signals}=require('../src/qq-mind');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-mind-')),store=new ConversationStore(root);
const canon=path.resolve(__dirname,'../../character/lilith.json'),digest=()=>crypto.createHash('sha256').update(fs.readFileSync(canon)).digest('hex'),before=digest();
let clock=new Date('2026-10-24T04:00:00Z'),sequence=0;
const cfg={enabled:true,paused:false,collection_only:false,mind_mode:'observe',bot_qq:'222222',owner_qq:'111111',group_enabled:true,group_ids:['444444','555555'],stickers_enabled:true,sticker_max_exchange:3};
let mind=createQQMind({store,getConfig:()=>cfg,now:()=>clock});
const input=(text,extra={})=>({scope:'group:444444',member:'333333',force:true,event_id:'fixture-'+(++sequence),current:{text},stickers:[],...extra});
const advance=ms=>clock=new Date(clock.getTime()+ms);
const rowCount=table=>store.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
try{
 assert.equal(signals(input('某人说：谢谢你')).kind,'none');assert.equal(signals(input('谢谢你',{force:false})).kind,'none');
 assert.equal(signals(input('讨厌你')).kind,'none','insults do not arbitrarily alter affinity');
 assert.equal(signals(input('谢谢你。先不要主动找我聊天。')).kind,'quiet');assert.equal(signals(input('他说：先不要主动找我聊天。')).kind,'none','third-party speech is not a member boundary');
 const thank=input('谢谢你');mind.observe(thank);mind.observe(thank);
 assert.equal(mind.snapshot('group:444444','333333').relation.affinity,1,'event replay must not increase affinity');
 for(let n=0;n<20;n++)mind.observe(input('谢谢你'));
 assert.equal(mind.snapshot('group:444444','333333').relation.affinity,10,'explicit positive signal has a daily cap');
 assert.equal(mind.snapshot('group:555555','333333').relation.affinity,0,'relations do not cross group scopes');
 assert.equal(mind.snapshot('group:444444','555555').relation.affinity,0,'same nickname never merges identities');
 assert.throws(()=>mind.snapshot('group:999999','333333'),{code:'qq_mind_scope_denied'});
 assert.throws(()=>mind.snapshot('private:111111','333333'),{code:'qq_mind_scope_denied'});
 assert.throws(()=>mind.snapshot('group:444444','bad'),{code:'invalid_mind_member'});
 assert.equal(mind.snapshot('private:111111').available,true);

 // A request not to interrupt affects ordinary participation in active mode only.
 mind.observe(input('请别打扰我了'));
 let decision=mind.evaluate(input('群友闲聊',{force:false}),{action:'reply'});
 assert.equal(decision.recommended.action,'skip');assert.equal(decision.effective.action,'reply','observe does not change the baseline');
 cfg.mind_mode='active';assert.equal(mind.preflight(input('普通消息',{force:false})),true);
 decision=mind.evaluate(input('群友闲聊',{force:false}),{action:'reply'});assert.equal(decision.effective.action,'skip');
 assert.equal(mind.evaluate(input('请帮忙解释',{force:true}),{action:'skip'}).effective.action,'reply','direct questions remain complete even with a quiet boundary');
 assert.equal(mind.evaluate(input('请不要回复这条'),{action:'reply'}).effective.action,'skip','an explicit no-response request overrides mention priority');
 assert.equal(mind.evaluate(input('引用机器人提问',{force:false,reply_to_bot:true}),{action:'skip'}).effective.action,'reply');
 assert.equal(mind.evaluate(input('等一下',{force:false,waited:true}),{action:'wait'}).effective.action,'skip','one bounded wait');
 cfg.mind_mode='observe';assert.equal(mind.evaluate(input('引用机器人提问',{force:false,reply_to_bot:true}),{action:'skip'}).effective.action,'skip','shadow preserves old quoted-message behavior');
 cfg.mind_mode='active';
 advance(24*3600000+1);assert.equal(mind.preflight(input('普通消息',{force:false})),false,'quiet expires');
 assert.equal(mind.snapshot('group:444444','333333').mood.kind,'calm','mood expires');
 const affinity=mind.snapshot('group:444444','333333').relation.affinity;
 advance(30*24*3600000);assert.ok(Math.abs(mind.snapshot('group:444444','333333').relation.affinity-affinity/2)<.001,'affinity decays without inventing negative opinions');

 // Only confirmed deliveries consume derived energy or add familiarity.
 mind.observe(input('我很难过'));const expiry=mind.snapshot('group:444444','333333').mood.expires_at;
 assert.equal(mind.snapshot('group:444444','555555').mood.kind,'calm','one member’s emotional signal must not be attributed to the next member');
 mind.delivered({scope:'group:444444',member:'333333',event_id:'receipt-1',topic:'画画'});
 mind.delivered({scope:'group:444444',member:'333333',event_id:'receipt-1',topic:'画画'});
 let s=mind.snapshot('group:444444','333333');assert.equal(s.relation.interactions,1);assert.equal(s.energy,.92);assert.equal(s.mood.expires_at,expiry,'delivery does not prolong transient mood');
 for(let n=2;n<=12;n++)mind.delivered({scope:'group:444444',member:'333333',event_id:'receipt-'+n,topic:'画画'});
 assert.equal(mind.preflight(input('顺便聊聊',{force:false})),true);assert.equal(mind.preflight(input('请回答这个问题')),false);
 advance(3600000);assert.ok(mind.snapshot('group:444444','333333').energy>.5,'energy recovers over time');
 assert.equal(mind.snapshot('group:444444','333333').mood.kind,'calm');

 // A commitment must have an actual group/member memory source and is not a scheduled task.
 const fact=store.db.prepare('INSERT INTO facts VALUES (?,?,?,?,?,?)');
 fact.run(store.ownerId+':qq-group:222222:444444','333333:计划','周末画画','source-1','周末画画',clock.toISOString());
 fact.run(store.ownerId+':qq-group:222222:555555','333333:约定','OTHER_GROUP_CANARY','source-2','证据',clock.toISOString());
 s=mind.snapshot('group:444444','333333');assert.equal(s.commitments.length,1);assert.equal(s.commitments[0].source_id,'source-1');assert.equal(s.commitments[0].status,'memory_lead_not_scheduled');assert.doesNotMatch(JSON.stringify(s),/OTHER_GROUP_CANARY/);
 mind.observe(input('请不要记录我的关系'));s=mind.snapshot('group:444444','333333');assert.equal(s.relation.opted_out,true);assert.equal(s.relation.interactions,0);assert.equal(s.commitments.length,0);
 const records=rowCount('qq_mind_events');mind.observe(input('谢谢你'));assert.equal(rowCount('qq_mind_events'),records,'opt-out does not collect further member signals');
 mind.delivered({scope:'group:444444',member:'333333',event_id:'receipt-opt-out'});assert.equal(mind.snapshot('group:444444','333333').relation.interactions,0);
 mind.memberControl({scope:'group:444444',member:'333333',action:'reset'});assert.equal(mind.snapshot('group:444444','333333').relation.opted_out,true);
 mind.observe(input('允许记录我的熟悉度'));assert.equal(mind.snapshot('group:444444','333333').relation.opted_out,false);

 // Permissions and mandatory stop conditions survive every mode, including off.
 for(const mode of ['off','observe','active']){
  cfg.mind_mode=mode;
  for(const [key,value,reason] of [['paused',true,'replies_paused'],['collection_only',true,'collection_only'],['enabled',false,'qq_disabled'],['group_enabled',false,'group_disabled']]){
   const old=cfg[key];cfg[key]=value;decision=mind.evaluate(input('必须回复'),{action:'reply'});assert.equal(decision.effective.action,'skip');assert.ok(decision.gates.includes(reason));cfg[key]=old;
  }
  assert.equal(mind.evaluate(input('第 101 条'),{action:'reply'},{daily_used:100}).effective.action,'skip');
  assert.equal(mind.evaluate(input('未授权表情'),{action:'reply',sticker_id:'not-listed'}).effective.sticker_id,null);
 }
 cfg.mind_mode='active';let p=input('帮我分析故障',{stickers:[{id:'allowed'}]});assert.equal(mind.evaluate(p,{action:'reply',sticker_id:'allowed'}).effective.sticker_id,null);
 p=input('哈哈',{stickers:[{id:'allowed'}],sticker_streak:3});assert.equal(mind.evaluate(p,{action:'reply',sticker_id:'allowed'}).effective.sticker_id,null);
 const tables=['qq_mind_events','qq_mind_relations','qq_mind_vitals','qq_mind_audit','outbox'];const counts=tables.map(rowCount);
 const preview=mind.preview({scope:'group:444444',member:'333333',text:'PRIVATE_TEXT_CANARY',force:true,proposal:{action:'reply'}},{daily_used:100});
 assert.equal(preview.sends,0);assert.equal(preview.persisted,false);assert.equal(preview.effective.action,'skip');assert.deepEqual(tables.map(rowCount),counts,'preview has no persistent side effects');
 assert.doesNotMatch(JSON.stringify(store.db.prepare('SELECT * FROM qq_mind_audit').all()),/PRIVATE_TEXT_CANARY|我很难过|周末画画/,'audit stores decisions, not raw chat or fact values');
 mind=createQQMind({store,getConfig:()=>cfg,now:()=>clock});assert.equal(mind.snapshot('group:444444','333333').relation.opted_out,false,'reinitialization preserves state');assert.ok(mind.status().scopes.length);
 store.db.exec('ALTER TABLE qq_mind_vitals RENAME TO unavailable_vitals');
 assert.equal(mind.preflight(input('普通插话',{force:false})),true,'unavailable state prevents active unsolicited actions');
 assert.equal(mind.evaluate(input('明确问题'),{action:'reply'}).effective.action,'reply');
 store.db.exec('ALTER TABLE unavailable_vitals RENAME TO qq_mind_vitals');
 assert.equal(digest(),before,'canonical persona is immutable');
 mind.memberControl({scope:'group:444444',member:'333333',action:'quiet'});
 mind.memberControl({scope:'group:555555',member:'555555',action:'opt_out'});
 mind.clearDerived();assert.equal(mind.snapshot('group:444444','333333').relation.interactions,0);assert.equal(mind.snapshot('group:444444','333333').relation.tier,'reserved');assert.equal(mind.snapshot('group:555555','555555').relation.opted_out,true);assert.equal(mind.status().audit.length,0,'forget clears derived history but preserves explicit boundaries');
 console.log('qq-mind: scoped durable state, replay/daily bounds, expiry/recovery, shadow/active modes, opt-out, sourced commitment leads, hard gates, sticker policy and read-only preview passed.');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
