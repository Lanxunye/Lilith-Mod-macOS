'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge'),{privateMention}=require('../src/qq-private-art');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-private-art-')),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');fs.writeFileSync(path.join(root,'image.png'),png);
let store,bridge,id=0,clock=new Date('2026-10-27T08:00:00Z'),jobs=new Map(),sends=[],missing=false,onProbe,projected=0;
const art={submit(action,c){assert.equal(c.source,'qq_private');assert.equal(c.authorizePrivate(),true);const j={id:crypto.randomUUID(),status:'rendering',image_sha256:crypto.createHash('sha256').update(png).digest('hex')};jobs.set(j.id,j);return j;},get:id=>jobs.get(id),asset:()=>path.join(root,'image.png')};
function open(){store=new ConversationStore(root);bridge=createQQBridge({root,store,artwork:art,autoTick:false,now:()=>clock,getPlayerName:()=> '主人',onArtDelivery:()=>projected++,request:async(url,options)=>{if(url.endsWith('/get_login_info')){if(onProbe){const cb=onProbe;onProbe=null;cb();}return Response.json({status:'ok',retcode:0,data:{user_id:222222}});}assert.ok(url.endsWith('/send_private_msg'));sends.push(JSON.parse(options.body));return Response.json({status:'ok',retcode:0,data:missing?{}:{message_id:sends.length}});},chat:async(session,b,channel)=>{if(b._qq_art_feedback){assert.equal(channel,'qq');assert.ok(bridge.privateArt.feedback(b.request_id,session));store.enqueue(session,b.request_id,'111111','这幅画让我慢慢画。');}}});}
function event(text='画一张你睡觉的样子',mention=true,user=111111,extras={}){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:++id,message:[...(mention?[{type:'at',data:{qq:222222}}]:[]),{type:'text',data:{text}}],...extras});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
const command=text=>event(text,false),images=()=>sends.filter(s=>s.message.some(m=>m.type==='image')).length;
async function tick(n=1){for(let k=0;k<n;k++){clock=new Date(clock.getTime()+61000);await bridge.tick();}}
const complete=()=>{for(const j of jobs.values())j.status='completed';};
(async()=>{try{
 open();bridge.configure({enabled:true,paused:false,bot_qq:'222222',owner_qq:'111111',api_token:'token',event_secret:'secret',private_art_enabled:true,group_enabled:false,group_ids:['444444'],min_interval_ms:1000});
 assert.equal(privateMention([], '我刚才说 @莉莉丝 画一张', '222222').force,false);assert.equal(privateMention([], '@别人 画一张', '222222').force,false);
 assert.equal(event(undefined,true,333333).accepted,false);event(undefined,false);await tick();assert.equal(jobs.size,0);
 for(let k=0;k<25;k++){event();await tick();complete();await tick(2);}assert.equal(images(),25,'private drawing exceeds both ten and twenty without daily quota');assert.equal(bridge.status().private_art_daily_limit,null);assert.equal(bridge.status().group_art_groups[0].used,0);assert.equal(projected,25);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM qq_private_deliveries WHERE sticker=1').get().n,0,'illustrations do not consume private sticker slots');
 event('@莉莉丝 画一张花园里的你',false);await tick();complete();await tick(2);assert.equal(images(),26,'explicit private text-prefix @ is supported');
 const rawId=id+1;event();event(undefined,true,111111,{message_id:rawId});await tick();assert.equal(jobs.size,27,'duplicate event cannot create another image');
 command('/lls pdraw off');assert.equal(bridge.status().private_art_enabled,false);complete();const before=images();await tick(3);assert.equal(images(),before);command('/lls pdraw on');await tick();assert.equal(bridge.status().private_art_enabled,true);
 event();await tick();complete();await tick();onProbe=()=>command('/lls pdraw off');await tick(2);assert.equal(images(),before,'off during identity check cancels pending image');
 command('/lls pdraw on');await tick();event();await tick();clock=new Date('2026-10-28T16:00:01Z');complete();await tick(2);assert.equal(images(),before+1,'private results are not cancelled at daily rollover');
 event();await tick();complete();await tick();missing=true;await tick();assert.equal(bridge.status().paused,true);const attempts=images();missing=false;bridge.configure({paused:false});await tick();assert.equal(images(),attempts,'unknown receipt is not retried');
 await bridge.close();store.close();open();assert.equal(bridge.status().private_art_enabled,true);await tick();assert.equal(images(),attempts,'restart never duplicates image delivery');
 command('/lls states');await tick();assert.match(sends.at(-1).message.find(m=>m.type==='text').data.text,/私聊绘图：开启/);assert.ok(bridge.privateArt.recent().every(r=>r.scene));
 assert.ok(sends.every(s=>s.user_id==='111111'&&!s.group_id));
 console.log('qq-private-art: owner-only actual/prefix @, independent unlimited quota, restart/dedup, toggles/probe cancellation, midnight survival, unknown receipts, journal projection and sticker isolation passed');
}finally{await bridge?.close();store?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
