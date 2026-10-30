'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQCapabilities,DEFAULTS}=require('../src/qq-capabilities'),{intentFor,semanticAllowed}=require('../src/sticker-selection');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-sticker-selection-')),store=new ConversationStore(root);let tick=1000,seen=[];
const config={...DEFAULTS,bot_qq:'222222',owner_qq:'111111',session_id:'desktop-pet',stickers_enabled:true,private_stickers_enabled:true,group_enabled:true,group_stickers_enabled:true,group_ids:['444444'],owner_stickers_enabled:true};
const options={root,store,getConfig:()=>config,now:()=>++tick,conversation:async messages=>{seen.push(JSON.parse(messages[1].content));return '{"sticker_id":null}';}};
let cap=createQQCapabilities(options);
store.db.exec("CREATE TABLE IF NOT EXISTS qq_private_deliveries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,bot TEXT,owner TEXT,created_ms INTEGER,sticker INTEGER,state TEXT)");
const insert=store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)');
(async()=>{try{
 for(let i=0;i<90;i++)insert.run('image-'+String(i).padStart(3,'0'),'private:111111',path.join(root,'unused-'+i),'image/gif','微笑，开心，赞同。',new Date(0).toISOString());
 const key='private:111111',hint='开心';let union=new Set(),first=cap.stickers(key,hint);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM qq_sticker_exposure').get().n,0,'candidate preview is read-only');
 for(let i=0;i<5;i++){const choices=cap.stickers(key,hint);choices.forEach(s=>union.add(s.id));await cap.decidePrivate({current:{text:'开心'},reply:'真好，替你开心。',stickers:choices});}
 assert.equal(union.size,90,'same-topic selection exposes the whole equal-quality pool rather than a fixed twenty');assert.ok(seen.every(x=>x.reply_to_send==='真好，替你开心。'));assert.ok(seen.every(x=>x.stickers.every(s=>s.usage)));
 const repeated=first[0].id;
 for(let i=0;i<3;i++){const id='qq:used'+i;store.enqueue('desktop-pet','used'+i,'111111','');store.db.prepare("UPDATE outbox SET state='sent',platform_id='receipt' WHERE id=?").run(id);store.db.prepare('INSERT INTO qq_delivery_meta VALUES (?,?)').run(id,JSON.stringify({scope:key,sticker_id:repeated,sticker_only:true,sticker_parent:id}));store.db.prepare("INSERT INTO qq_private_deliveries(id,bot,owner,created_ms,sticker,state) VALUES (?,?,?,1,1,'sent')").run(id,config.bot_qq,config.owner_qq);}
 assert.ok(!cap.stickers(key,hint).some(s=>s.id===repeated),'recently overused picture yields to equal-quality alternatives');
 cap=createQQCapabilities(options);assert.ok(!cap.stickers(key,hint).some(s=>s.id===repeated),'usage and exposure survive restart');
 assert.equal(cap.stickers(key,'再发刚才那张表情')[0].id,repeated,'explicit repeat can retrieve the eligible last image');
 insert.run('fear','private:111111','unused','image/gif','睁大眼睛，惊恐惊讶，张大嘴','x');insert.run('sleep','private:111111','unused','image/gif','安静睡觉，晚安，好梦','x');insert.run('stock','library:public','unused','image/gif','股票基金大涨','x');store.db.prepare('INSERT INTO qq_meme_assets VALUES (?,?,1)').run('stock',JSON.stringify({categories:[{key:'_stock'}],sources:[]}));
 const sleepy=cap.stickers(key,'抱抱我',{current:'抱抱我',reply:'闭上眼睛，安心睡吧，晚安。'});assert.ok(sleepy.some(s=>s.id==='sleep'));assert.ok(!sleepy.some(s=>s.id==='fear'||s.id==='stock'));
 assert.equal(intentFor({current:'刚被噩梦吓醒了，哄我睡',reply:'别怕，我在，再安心睡吧。'}),'bedtime');
 assert.equal(intentFor({current:'嗯嗯',reply:'乖，闭上眼睛睡吧。'}),'bedtime');assert.equal(intentFor({current:'刚刚打游戏中奖了',recent:[{text:'晚安'}]}),'general');
 assert.equal(semanticAllowed('惊恐反应',['sleep'],'bedtime'),false);assert.equal(semanticAllowed('被逗后打闹，恼羞成怒，不是拥抱',['like'],'bedtime'),false);
 assert.equal(cap.stickers('group:999999','晚安').length,0);assert.equal(cap.stickers('private:333333','开心').length,0);
 config.group_stickers_enabled=false;assert.equal(cap.stickers('group:444444','开心').length,0);
 assert.doesNotMatch(JSON.stringify(store.db.prepare('SELECT * FROM qq_sticker_selection_audit').all()),/替你开心|闭上眼睛/,'audit stores decisions, never chat text');
 console.log('sticker-selection: full equal-quality pool rotation, restart persistence, recent-use avoidance, explicit repeat, post-reply intent, bedtime safety, scope and audit privacy passed');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
