'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-voice-modes-'));let store,bridge,id=0,clock=Date.parse('2026-10-26T04:00:00Z'),sends=[],syntheses=0,fail=false,hold=false,release=null;
const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
function open(){store=new ConversationStore(root);bridge=createQQBridge({root,store,autoTick:false,now:()=>new Date(clock),getPlayerName:()=>'',chat:async()=>{throw Error('no model expected');},
 request:async(url,options)=>{const action=new URL(url).pathname.slice(1);if(action==='get_login_info')return Response.json({status:'ok',retcode:0,data:{user_id:222222}});if(action==='can_send_record')return Response.json({status:'ok',retcode:0,data:{yes:true}});assert.ok(['send_private_msg','send_group_msg'].includes(action));sends.push({action,...JSON.parse(options.body)});return Response.json({status:'ok',retcode:0,data:{message_id:sends.length}});},
 capabilitiesOptions:{voiceSynthesizer:async(text,context)=>{syntheses++;assert.ok(['qq','qq_group'].includes(context.channel));if(hold)await new Promise(r=>release=r);if(fail)throw Error('failed synthesis');return {bytes:wav,type:'audio/wav'};}}});}
function command(text,user=111111,messageId=++id){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:messageId,message:[{type:'text',data:{text}}]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
function queue(group,style='soft',text='一句回复。',extra={}){const request='fixture-'+(++id),session=group?'qq-group:222222:'+group:'desktop-pet',key='qq:'+request;
 store.enqueue(session,request,group?'group:'+group:'111111',text);const meta={scope:group?'group:'+group:'private:111111',member:group?'333333':'111111',created_ms:clock,observed_watermark:store.db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM qq_observed WHERE bot=? AND group_id=?').get('222222',group||'').n,reply_id:group?'88':null,...extra};
 store.db.prepare('INSERT INTO qq_delivery_meta VALUES (?,?)').run(key,JSON.stringify(meta));if(style)store.db.prepare('INSERT INTO reply_parts VALUES (?,?)').run(session+':'+request+':assistant',JSON.stringify({speech:{style,ending:'falling'}}));return key;}
async function tick(){clock+=61000;await bridge.tick();}
async function waitHeld(){for(let n=0;n<100&&!release;n++)await new Promise(r=>setTimeout(r,1));assert.ok(release);}
(async()=>{try{
 open();bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'secret',group_enabled:true,group_ids:['444444','555555'],voice_enabled:true,group_voice_enabled:true,voice_mode:'gentle',min_interval_ms:1000,max_per_minute:20});
 assert.throws(()=>bridge.configure({voice_mode:'invalid'}),/invalid_voice_mode/);
 for(const group of [null,'444444']){
  queue(group,'soft');await tick();assert.deepEqual(sends.at(-1).message.map(s=>s.type),['record']);assert.equal(sends.at(-1).action,group?'send_group_msg':'send_private_msg');
  for(const style of ['neutral','calm','bright','sad','angry',null]){const before=syntheses;queue(group,style,'晚安只是引用：这里未标记为温柔。');await tick();assert.deepEqual(sends.at(-1).message.filter(s=>s.type!=='reply').map(s=>s.type),['text']);assert.equal(syntheses,before,'gentle mode must not synthesize without explicit soft tag');}
 }
 assert.equal(command('/lls tts all',333333).accepted,false);
 const duplicate=++id;command('/lls tts all',111111,duplicate);command('/lls tts all',111111,duplicate);await tick();assert.equal(bridge.status().voice_mode,'all');
 for(const group of [null,'444444']){queue(group,'neutral');await tick();assert.deepEqual(sends.at(-1).message.map(s=>s.type),['record']);}
 command('/lls tts all');await tick();assert.equal(bridge.status().voice_mode,'gentle');
 command('/lls group tts off');await tick();assert.equal(bridge.status().group_voice_enabled,false);assert.equal(bridge.status().voice_enabled,true);
 queue('444444','soft');await tick();assert.ok(sends.at(-1).message.some(s=>s.type==='text'));
 command('/lls group tts on');await tick();command('/lls tts off');await tick();assert.equal(bridge.status().group_voice_enabled,true);assert.equal(bridge.status().voice_enabled,false);
 queue('444444','soft');await tick();assert.deepEqual(sends.at(-1).message.map(s=>s.type),['record']);queue(null,'soft');await tick();assert.equal(sends.at(-1).message[0].type,'text');
 const before=sends.length;const denied=queue('666666','soft');await tick();assert.equal(sends.length,before);assert.equal(store.db.prepare('SELECT state FROM outbox WHERE id=?').get(denied).state,'cancelled');
 fail=true;queue('444444','soft');await tick();assert.ok(sends.at(-1).message.some(s=>s.type==='text'));assert.equal(bridge.status().paused,false);fail=false;
 // A mode change during synthesis must discard the old all-mode audio.
 bridge.configure({voice_mode:'all'});hold=true;release=null;queue('444444','neutral');clock+=61000;let flight=bridge.tick();await waitHeld();command('/lls tts all');release();await flight;assert.equal(sends.at(-1).message.filter(s=>s.type!=='reply')[0].type,'text');await tick();
 // Changing private preferences does not revoke an unrelated group voice.
 release=null;queue('444444','soft');clock+=61000;flight=bridge.tick();await waitHeld();bridge.configure({voice_enabled:true});release();await flight;assert.deepEqual(sends.at(-1).message.map(s=>s.type),['record']);
 // A group-only switch revokes the late audio without touching private TTS.
 release=null;queue('444444','soft');clock+=61000;flight=bridge.tick();await waitHeld();bridge.configure({group_voice_enabled:false});release();await flight;assert.equal(sends.at(-1).message.filter(s=>s.type!=='reply')[0].type,'text');assert.equal(bridge.status().voice_enabled,true);bridge.configure({group_voice_enabled:true});
 // An intervening group message makes a non-forced voice obsolete.
 release=null;const stale=queue('444444','soft');clock+=61000;flight=bridge.tick();await waitHeld();const beforeStale=sends.length;
 store.db.prepare('INSERT INTO qq_observed VALUES (?,?,?,?,?)').run('new-group-event','222222','444444','{}',clock);release();await flight;assert.equal(sends.length,beforeStale);assert.equal(store.db.prepare('SELECT state FROM outbox WHERE id=?').get(stale).state,'cancelled');
 // Closing the group gate during synthesis cancels delivery completely.
 release=null;const cancelled=queue('444444','soft');clock+=61000;flight=bridge.tick();await waitHeld();const count=sends.length;bridge.configure({group_enabled:false});release();await flight;assert.equal(sends.length,count);assert.equal(store.db.prepare('SELECT state FROM outbox WHERE id=?').get(cancelled).state,'cancelled');hold=false;
 bridge.configure({group_enabled:true});command('/lls state');await tick();assert.match(sends.at(-1).message[0].data.text,/群聊语音：开启/);assert.match(sends.at(-1).message[0].data.text,/仅温柔句子/);
 const used=bridge.status().group_daily_used;assert.ok(used>0&&used<=100);
 await bridge.close();store.close();open();assert.equal(bridge.status().voice_mode,'gentle');assert.equal(bridge.status().group_voice_enabled,true);assert.equal(bridge.status().voice_enabled,true);assert.equal(bridge.status().group_daily_used,used);
 console.log('qq-voice-modes: per-sentence soft gate, all toggle/dedup, independent private/group switches, voice-only group segments, whitelist, fallback, in-flight mode/gate changes, state, quota and restart passed (fake OneBot)');
}finally{await bridge?.close();store?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
