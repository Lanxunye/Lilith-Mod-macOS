'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge'),{parseDrawingRequest}=require('../src/qq-group-art');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-group-art-'));
let store,bridge,clock=new Date('2026-10-26T05:00:00Z'),id=0,chatCalls=0,sends=[],jobs=new Map(),reject=false,missing=false,onProbe=null,selectedSticker=null;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const asset=path.join(root,'render.png');fs.writeFileSync(asset,png);
const artwork={submit(action,context){if(reject)throw Object.assign(Error('busy'),{code:'art_busy'});assert.equal(action.kind,'illustration');assert.equal(context.source,'qq_group');assert.match(context.requestId,/^qqgroup-art:[a-f0-9]{64}$/);const j={id:crypto.randomUUID(),status:'rendering',image_sha256:crypto.createHash('sha256').update(png).digest('hex')};jobs.set(j.id,j);return j;},get:id=>jobs.get(id),asset:()=>asset};
const request=async(url,opts)=>{const body=JSON.parse(opts.body);
 if(url.endsWith('/get_login_info')){if(onProbe){const cb=onProbe;onProbe=null;cb();}return Response.json({status:'ok',retcode:0,data:{user_id:222222}});}
 assert.ok(url.endsWith('/send_group_msg')||url.endsWith('/send_private_msg'));sends.push(body);return Response.json({status:'ok',retcode:0,data:missing?{}:{message_id:sends.length}});
};
function open(){store=new ConversationStore(root);bridge=createQQBridge({root,store,autoTick:false,now:()=>clock,artwork,request,decide:async()=>({action:'reply',sticker_id:selectedSticker}),getPlayerName:()=> '主人',chat:async(session,body)=>{chatCalls++;const group=JSON.parse(body.message.split('\n').slice(1).join('\n'));assert.ok(group.generated_images.every(j=>typeof j.scene==='string'));if(body._qq_art_feedback){assert.equal(bridge.groupArt.feedback(body.request_id,session).state,'rendering');store.enqueue(session,body.request_id,'group:'+session.split(':')[2],'花园里的安静，也给你留一点。');}}});}
function event(text='画一张莉莉丝在花园里看书',group='444444',mention=true,extra={}){const raw=JSON.stringify({post_type:'message',message_type:'group',self_id:222222,user_id:333333,group_id:group,message_id:++id,message:[...(mention?[{type:'at',data:{qq:'222222'}}]:[]),{type:'text',data:{text}}],...extra});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
function command(text,user=111111){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:++id,message:[{type:'text',data:{text}}]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
async function tick(n=1){for(let i=0;i<n;i++){clock=new Date(clock.getTime()+3100);await bridge.tick();}}
const groupUsed=g=>bridge.status().group_art_groups.find(r=>r.group_id===g).used;
const complete=()=>{for(const j of jobs.values())if(j.status==='rendering')j.status='completed';};
async function draw(group='444444'){const before=jobs.size;event(undefined,group);await tick();assert.equal(jobs.size,before+1);complete();await tick(2);}
const imageCount=()=>sends.filter(s=>s.message.some(m=>m.type==='image')).length;
(async()=>{try{
 open();bridge.configure({enabled:true,paused:false,bot_qq:'222222',owner_qq:'111111',group_enabled:true,group_ids:['444444','555555'],group_art_enabled:true,api_token:'token',event_secret:'secret',min_interval_ms:1000,max_per_minute:20,quiet_ms:0});
 assert.equal(parseDrawingRequest('不要画一张图'),null);assert.equal(parseDrawingRequest('这幅画很漂亮'),null);
 event(undefined,'444444',false);await tick();assert.equal(jobs.size,0);assert.equal(chatCalls,1,'selective conversation cannot generate an image');
 event('@222222 画一张图','444444',false);await tick();assert.equal(jobs.size,0,'textual mention is not an actual @');
 assert.equal(event(undefined,'666666').accepted,false);assert.equal(command('/lls draw off',333333).accepted,false);
 assert.equal(event('/lls draw off').reason,'commands_owner_private_only');assert.equal(bridge.status().group_art_enabled,true);
 const duplicateId=id+1;event();event(undefined,'444444',true,{message_id:duplicateId});await tick();assert.equal(jobs.size,1);assert.equal(groupUsed('444444'),1);complete();await tick(2);assert.equal(imageCount(),1);
 assert.deepEqual(sends.find(s=>s.message.some(m=>m.type==='image')).message.map(m=>m.type),['image']);
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel='qq_group' AND content LIKE '【绘图已发送%'").get().n,1);
 reject=true;event();await tick(2);assert.equal(groupUsed('444444'),1,'pre-submission busy does not consume budget');reject=false;
 for(let n=1;n<10;n++)await draw();assert.equal(groupUsed('444444'),10);
 const beforeQuota=jobs.size;event();await tick(2);assert.equal(jobs.size,beforeQuota);assert.match(sends.at(-1).message.find(m=>m.type==='text').data.text,/本群今天.*10/);
 for(let n=0;n<10;n++)await draw('555555');assert.equal(groupUsed('555555'),10);assert.equal(imageCount(),20,'each group has its own ten-image quota');
 await bridge.close();store.close();open();assert.equal(groupUsed('444444'),10);assert.equal(groupUsed('555555'),10,'quota persists across restart');
 clock=new Date('2026-10-26T16:00:01Z');assert.equal(groupUsed('444444'),0,'Beijing midnight resets per-group budget');
 const beforeFile=jobs.size;event('画一张图片','444444',true,{message:[{type:'at',data:{qq:'222222'}},{type:'text',data:{text:'画一张图片'}},{type:'file',data:{url:'https://never-fetch.invalid'}}]});await tick(2);assert.equal(jobs.size,beforeFile,'no file or attachment input');
 event();await tick();const imagesBeforeOff=imageCount();command('/lls draw off');assert.equal(bridge.status().group_art_enabled,false);complete();await tick(4);assert.equal(imageCount(),imagesBeforeOff,'off cancels rendering delivery');
 command('/lls draw on');await tick();assert.equal(bridge.status().group_art_enabled,true);
 event();await tick();complete();await tick();onProbe=()=>command('/lls draw off');await tick(2);assert.equal(imageCount(),imagesBeforeOff,'revocation during probe prevents send');
 command('/lls draw on');await tick();event();await tick();complete();await tick(2);assert.equal(imageCount(),imagesBeforeOff+1);
 event();await tick();command('/lls group off');assert.equal(bridge.status().group_enabled,false);complete();await tick(4);assert.equal(imageCount(),imagesBeforeOff+1);assert.equal(event().accepted,false);
 command('/lls group on');await tick();command('/lls states');await tick();assert.match(sends.at(-1).message[0].data.text,/每群每日最多 10/);
 const beforeUnknown=imageCount();event();await tick();complete();await tick();missing=true;await tick();assert.equal(bridge.status().paused,true);assert.equal(imageCount(),beforeUnknown+1);
 const usedBefore=groupUsed('444444');missing=false;bridge.configure({paused:false});await tick(2);assert.equal(imageCount(),beforeUnknown+1);assert.equal(groupUsed('444444'),usedBefore,'unknown receipt keeps quota and never retries');
 // Old-day renders cannot arrive alongside ten new-day images.
 event(undefined,'555555');await tick();const oldDayImages=imageCount();clock=new Date('2026-10-27T16:00:01Z');complete();await tick(3);assert.equal(imageCount(),oldDayImages);assert.equal(groupUsed('555555'),0);
 selectedSticker=crypto.createHash('sha256').update(png).digest('hex');const stickerFile=path.join(root,'qq-media',selectedSticker+'.png');fs.writeFileSync(stickerFile,png);
 store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(selectedSticker,'private:111111',stickerFile,'image/png','开心，打闹',clock.toISOString());
 bridge.configure({stickers_enabled:true,group_stickers_enabled:true,owner_stickers_enabled:true});const beforeSticker=imageCount();event('打闹一下吧');await tick(2);assert.equal(imageCount(),beforeSticker+1,'enabling group stickers permits only an allowed library image');
 bridge.configure({group_stickers_enabled:false});event('打闹一下吧');await tick(2);assert.equal(imageCount(),beforeSticker+1,'group sticker disablement is checked before send');
 console.log('qq-group-art: real @ only, per-group durable 10/day, midnight/cross-day gate, no files/tools, busy release, receipts, disable during render/probe, owner-only commands and historical feedback passed');
}finally{await bridge?.close();store?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
