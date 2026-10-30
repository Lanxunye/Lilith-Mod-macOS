'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-sticker-delivery-'));let store=new ConversationStore(root),bridge;
 let at=Date.parse('2026-10-25T04:00:00Z'),failText=false;const sent=[];
 const id=crypto.createHash('sha256').update('standalone-sticker').digest('hex');
 const options=()=>({root,store,autoTick:false,now:()=>new Date(at),getPlayerName:()=> '主人',request:async(url,init)=>{
  if(url.endsWith('/get_login_info'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};
  const payload=JSON.parse(init.body);sent.push(payload);return {ok:true,json:async()=>{if(failText&&payload.message.some(x=>x.type==='text'))throw Error('uncertain_text');return {status:'ok',retcode:0,data:{message_id:sent.length}};}};
 }});
 function enqueue(request,text,group=false,sticker=true){const scope=group?'group:444444':'private:111111';store.enqueue(group?'group-test':'desktop-pet',request,group?'group:444444':'111111',text);
  store.db.prepare('INSERT INTO qq_delivery_meta VALUES (?,?)').run('qq:'+request,JSON.stringify({scope,member:group?'333333':'111111',sticker_id:sticker?id:null,reply_id:group?'42':null,created_ms:at,force:true}));}
 const tick=async()=>{at+=2000;await bridge.tick();};
 const row=request=>store.db.prepare('SELECT * FROM outbox WHERE id=?').get('qq:'+request);
 const seedCadence=()=>{for(let n=0;n<2;n++)store.db.prepare("INSERT INTO qq_private_deliveries(id,bot,owner,created_ms,sticker,state) VALUES (?,?,?,?,0,'sent')").run('seed:'+at+':'+n,'222222','111111',at);};
 try{
  bridge=createQQBridge(options());bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000,group_enabled:true,group_ids:['444444'],stickers_enabled:true,private_stickers_enabled:true,owner_stickers_enabled:true});
  const file=path.join(root,'qq-media',id+'.png');fs.writeFileSync(file,'fixture');store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(id,'private:111111',file,'image/png','微笑',new Date(at).toISOString());
  enqueue('group-image','',true);await tick();assert.deepEqual(sent.at(-1).message.map(x=>x.type),['image'],'group sticker never quotes the incoming message');
  enqueue('group-text','普通文字',true,false);await tick();assert.deepEqual(sent.at(-1).message.map(x=>x.type),['reply','text'],'ordinary text quoting stays available');
  seedCadence();enqueue('restart','先说一句');await tick();assert.deepEqual(sent.at(-1).message.map(x=>x.type),['text']);assert.equal(row('restart:sticker').state,'pending');
  const count=sent.length;await bridge.close();store.close();store=new ConversationStore(root);bridge=createQQBridge(options());await tick();
  assert.equal(sent.length,count+1);assert.deepEqual(sent.at(-1).message.map(x=>x.type),['image']);assert.equal(row('restart').state,'sent');assert.equal(row('restart:sticker').state,'sent');await tick();assert.equal(sent.length,count+1,'restart never repeats the acknowledged text or sticker');
  seedCadence();enqueue('revoke','文字照常发送');await tick();const before=sent.length;bridge.configure({private_stickers_enabled:false});await tick();assert.equal(sent.length,before);assert.equal(row('revoke:sticker').state,'cancelled');assert.equal(bridge.status().paused,false);
  bridge.configure({private_stickers_enabled:true});seedCadence();enqueue('new-message','旧话题文字');await tick();
  store.db.prepare("INSERT INTO inbox VALUES (?,?,'done',?)").run('new-private',JSON.stringify({owner:'111111',message:'换个话题'}),new Date(at).toISOString());await tick();assert.equal(row('new-message:sticker').state,'cancelled','new owner input supersedes an unsent sticker');
  seedCadence();enqueue('unknown-parent','回执不确定');failText=true;await tick();assert.equal(row('unknown-parent').state,'unknown');const afterUnknown=sent.length;
  failText=false;bridge.configure({paused:false});await tick();assert.equal(row('unknown-parent:sticker').state,'cancelled');assert.equal(sent.length,afterUnknown,'an uncertain text receipt cannot trigger its remaining sticker');
  for(const payload of sent.filter(p=>p.message.some(x=>x.type==='image')))assert.deepEqual(payload.message.map(x=>x.type),['image']);
  console.log('qq-sticker-delivery: unquoted image-only messages, separate text receipts, restart exactly once, revocation/new-input cancellation and uncertain-parent stop passed (fake OneBot)');
 }finally{await bridge?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
