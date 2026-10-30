'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge'),{beginParts}=require('../src/reply-parts');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-parts-delivery-'));let store=new ConversationStore(root),bridge,at=Date.now(),fail=false,onProbe;const sent=[];
 const options=()=>({root,store,autoTick:false,now:()=>new Date(at),getPlayerName:()=> '主人',request:async(url,init)=>{
  if(url.endsWith('/get_login_info')){onProbe?.();onProbe=null;return {ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:222222}})};}
  const p=JSON.parse(init.body);sent.push(p);return {ok:true,json:async()=>{if(fail)throw Error('unknown');return {status:'ok',retcode:0,data:{message_id:sent.length}};}};
 }});
 const image=crypto.createHash('sha256').update('parts-sticker').digest('hex');
 function stage(id,sticker=false){const result={text:'一\n二\n三',ui:{},messages:['一','二','三'].map(text=>({text,emotion:'happy',animation:'smile',duration_ms:6500}))};
  store.begin('desktop-pet',id,{message:'用户原话'});const d=beginParts(result,{target:'111111'},at);
  store.db.prepare('INSERT INTO qq_delivery_meta VALUES (?,?)').run('qq:'+id,JSON.stringify({scope:'private:111111',member:'111111',sticker_id:sticker?image:null,created_ms:at}));
  const mirror={target:'111111',text:result.text};d.mirror=mirror;store.commit('desktop-pet',id,'用户原话',result,'qq','fixture',mirror,null,d);return d;
 }
 const tail=id=>{const batch=store.db.prepare('SELECT * FROM reply_batches WHERE id=?').get(id);store.deliverPart(batch,at);};
 const tick=async()=>{at+=4000;await bridge.tick();};
 try{
  bridge=createQQBridge(options());bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',stickers_enabled:true,private_stickers_enabled:true,min_interval_ms:1000});
  const file=path.join(root,'qq-media',image+'.png');fs.writeFileSync(file,'fixture');store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(image,'private:111111',file,'image/png','微笑',new Date(at).toISOString());
  for(let n=0;n<2;n++)store.db.prepare("INSERT INTO qq_private_deliveries(id,bot,owner,created_ms,sticker,state) VALUES (?,?,?,?,0,'sent')").run('seed'+n,'222222','111111',at);
  const batch=stage('whole',true);await tick();assert.deepEqual(sent[0].message.map(x=>x.type),['text']);assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE request_id LIKE '%:sticker'").get().n,0,'sticker waits for final text part');
  tail(batch.id);await tick();tail(batch.id);await tick();assert.equal(sent.length,3);assert.ok(sent.every(p=>p.message[0].type==='text'));await tick();assert.deepEqual(sent.at(-1).message.map(x=>x.type),['image']);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM qq_private_deliveries').get().n,3,'one logical reply despite three texts plus image');
  const bad=stage('uncertain');await tick();tail(bad.id);fail=true;await tick();assert.equal(bridge.status().paused,true);tail(bad.id);const count=sent.length;fail=false;bridge.configure({paused:false});await tick();assert.equal(sent.length,count,'remaining tail cannot follow an unknown previous receipt');
  const interrupted=stage('interrupted');await tick();tail(interrupted.id);await bridge.close();store.close();store=new ConversationStore(root);bridge=createQQBridge(options());await tick();assert.equal(store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(interrupted.id).state,'cancelled','restart cancels unfinished burst without replay');
  const rev=stage('probe');onProbe=()=>store.cancelReplyParts('desktop-pet','newer');const prior=sent.length;await tick();assert.equal(sent.length,prior,'invalidation during identity probe is rechecked');
  console.log('reply-parts-delivery: text order, independent final sticker, once-per-turn cadence, per-part receipts, unknown-tail stop, restart and probe cancellation passed');
 }finally{await bridge?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
