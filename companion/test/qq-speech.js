'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-qq-speech-')),store=new ConversationStore(root);
let clock=Date.now(),chatCalls=0,sends=[],held=null,delay=false,fail=false,missingReceipt=false,chat;
const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
const request=async(url,opts)=>{const action=url.split('/').at(-1),body=JSON.parse(opts.body);
 if(action==='get_login_info')return Response.json({status:'ok',retcode:0,data:{user_id:222222}});
 if(action==='can_send_record')return Response.json({status:'ok',retcode:0,data:{yes:true}});
 if(action==='send_private_msg'){sends.push(body);return Response.json({status:'ok',retcode:0,data:missingReceipt?{}:{message_id:sends.length}});}
 throw Error('unexpected API '+action);
};
const bridge=createQQBridge({root,store,request,autoTick:false,now:()=>new Date(clock),getPlayerName:()=>'',
 speechStatus:()=>({enabled:true}),capabilitiesOptions:{voiceSynthesizer:async()=>{if(fail)throw Error('synthetic fail');if(delay)await new Promise(r=>held=r);return {bytes:wav,type:'audio/wav'};}},
 chat:async()=>{chatCalls++;throw Error('commands must not call model');}});
bridge.configure({enabled:true,paused:false,bot_qq:'222222',owner_qq:'111111',event_secret:'secret',api_token:'token',api_url:'http://127.0.0.1:3000',min_interval_ms:1000,max_per_minute:20,voice_mode:'all'});
function event(id,text,user=111111,extra={}){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:id,message:[{type:'text',data:{text}}],...extra});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
async function tick(){clock+=1100;await bridge.tick();}
function reply(id,text){store.enqueue('desktop-pet',id,'111111',text);store.db.prepare('INSERT OR REPLACE INTO qq_delivery_meta VALUES (?,?)').run('qq:'+id,JSON.stringify({scope:'private:111111',member:'111111'}));}
(async()=>{try{
 assert.equal(event(1,'/lls state',333333).accepted,false);
 assert.equal(event(2,'/lls tts on').command,true);event(2,'/lls tts on');await tick();assert.equal(bridge.status().voice_enabled,true);assert.equal(chatCalls,0);assert.match(sends.at(-1).message[0].data.text,/QQ语音已开启/);
 event(3,'/lls tts');event(3,'/lls tts');await tick();assert.equal(bridge.status().voice_enabled,false,'duplicate command cannot toggle twice');
 event(4,'/lls tts on');await tick();reply('reply-1','这是新的文字回复。');await tick();assert.equal(sends.at(-1).message.length,1);assert.equal(sends.at(-1).message[0].type,'record');assert.match(sends.at(-1).message[0].data.file,/^base64:\/\//);
 const count=sends.length;await tick();assert.equal(sends.length,count,'voice receipt prevents duplicate sends');
 delay=true;reply('reply-2','这条旧语音应该被关闭。');clock+=1100;const inFlight=bridge.tick();for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,1));assert.ok(held);
 event(5,'/lls tts off');held();await inFlight;assert.equal(sends.length,count+1,'off falls back to a single text without sending late audio');await tick();assert.equal(sends.at(-1).message[0].type,'text');
 bridge.configure({paused:true});event(6,'/lls state');await tick();assert.match(sends.at(-1).message[0].data.text,/QQ回复：已暂停/);
 assert.equal(chatCalls,0);assert.equal(store.recent('desktop-pet').length,0,'control commands do not enter conversation history');
 bridge.configure({paused:false,voice_enabled:true});delay=false;fail=true;reply('reply-3','合成失败也保留文字。');const beforeFail=sends.length;await tick();assert.equal(sends.length,beforeFail+1);assert.equal(sends.at(-1).message[0].type,'text');assert.equal(bridge.status().paused,false);assert.ok(bridge.status().qq_voice_last_error);
 assert.equal(event(7,'/lls tts on',111111,{message_type:'group',group_id:444444}).accepted,false);
 fail=false;delay=true;held=null;reply('superseded','旧语音不能迟到。');clock+=1100;const obsolete=bridge.tick();for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,1));assert.ok(held);
 const beforeNew=sends.length;event(8,'新的主人消息');store.db.prepare("UPDATE inbox SET state='cancelled' WHERE state='pending'").run();held();await obsolete;
 assert.equal(sends.length,beforeNew);assert.equal(store.db.prepare("SELECT state FROM outbox WHERE id='qq:superseded'").get().state,'cancelled');
 delay=false;missingReceipt=true;reply('unknown-voice','这一条只尝试发送一次。');await tick();assert.equal(bridge.status().paused,true);assert.equal(store.db.prepare("SELECT state FROM outbox WHERE id='qq:unknown-voice'").get().state,'unknown');
 const unknownCount=sends.length;bridge.configure({paused:false});await tick();assert.equal(sends.length,unknownCount,'unknown voice receipt never falls back to duplicate text');

 console.log('qq-speech: owner binding, command dedup/no model/no history, voice-only delivery, off during synth, paused status and failure fallback passed');
}finally{await bridge.close();store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
