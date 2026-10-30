'use strict';
// Real HTTP/archive/projection, delayed synthetic synthesis, controlled player.
// No production conversation, real audio playback or QQ message is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-text-follow-'));
process.env.LILITH_AI_DATA_DIR=root;process.env.LILITH_AI_CONFIG=path.join(root,'config.json');
fs.writeFileSync(process.env.LILITH_AI_CONFIG,JSON.stringify({mock_mode:true,media:{enabled:false}}));
const {createApp}=require(process.env.LILITH_VERIFY_SERVER||'../src/server');
const {ADAPTER}=require(path.join(path.dirname(require.resolve(process.env.LILITH_VERIFY_SERVER||'../src/server')),'chat-speech'));
const pause=()=>new Promise(r=>setTimeout(r,10));
async function wait(check){for(let n=0;n<300;n++){if(check())return;await pause();}throw Error('text_follow_timeout');}
const wav=Buffer.alloc(24044);wav.write('RIFF');wav.writeUInt32LE(24036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(24000,40);
let app,respond=[],players=[],fail=false,playerFail=false,requests=0;
(async()=>{try{
 app=createApp({chatEngine:'provider-test',replyPartsOptions:{autoTick:false},speechOptions:{autoTick:false,textLeadMs:20,
  request:async url=>{if(url.endsWith('/health'))return Response.json({adapter_sha256:ADAPTER});requests++;if(fail)return new Response('offline',{status:503});await new Promise(r=>respond.push(r));return new Response(wav,{headers:{'Content-Type':'audio/wav'}});},
  spawnPlayer:()=>{const child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('exit',143));players.push(child);if(playerFail)queueMicrotask(()=>child.emit('error',Error('cannot launch')));return child;}
 }});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(method,route,body){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();}
 const events=()=>api('GET','/v1/session/desktop-pet/events');
 const history=()=>api('GET','/v1/session/desktop-pet/history');
 const projection=()=>JSON.parse(fs.readFileSync(path.join(root,'shared-chat-events.json')));
 const send=id=>api('POST','/v1/session/desktop-pet/message',{request_id:id,message:'轻声说晚安。'});
 await api('PATCH','/v1/speech',{enabled:true});let returned=false;
 const first=send('first').then(r=>{returned=true;return r;});await wait(()=>respond.length===1);
 const firstRow=app.store.recent('desktop-pet').find(r=>r.role==='assistant');assert.ok(firstRow,'archive commits before playback');
 assert.equal(returned,false);assert.ok(!(await events()).messages.some(r=>r.id===firstRow.id));assert.ok(!(await history()).messages.some(r=>r.content===firstRow.content));
 assert.ok(projection().cursor<firstRow.seq,'projection cursor cannot skip a held message');
 respond.shift()();await wait(()=>players.length===1);assert.equal(returned,false,'allocating a player is not a spawn acknowledgement');
 players[0].emit('spawn');await first;assert.equal(app.speech.status().status,'playing','text starts before audio completion');
 assert.ok((await events()).messages.some(r=>r.id===firstRow.id));assert.ok((await history()).messages.some(r=>r.content===firstRow.content));players[0].emit('exit',0);await wait(()=>app.speech.status().status==='idle');
 // Delayed desktop continuations and proactive text obey the same barrier.
 const voiceText='第一句，轻一点说。';const result={text:voiceText,ui:{},messages:[voiceText,'第二句，慢慢地说。'].map(text=>({text,emotion:'neutral',animation:'idle',duration_ms:6500}))};
 const {beginParts}=require(path.join(path.dirname(require.resolve(process.env.LILITH_VERIFY_SERVER||'../src/server')),'reply-parts'));
 const delivery=beginParts(result,null);app.store.begin('desktop-pet','parts',{message:'分句'});app.store.commit('desktop-pet','parts','分句',result,'desktop','fixture',null,null,delivery);app.speech.poll();await wait(()=>respond.length===1);respond.shift()();await wait(()=>players.length===2);players[1].emit('spawn');await app.speech.waitForText('desktop-pet:parts:assistant');
 app.store.db.exec("UPDATE reply_batches SET next_at=0 WHERE state='pending'");await app.flushReplyParts();await pause();const tail=app.store.recent('desktop-pet').find(r=>r.request_id==='parts:part:1');assert.ok(tail);assert.ok(!projection().messages.some(r=>r.id===tail.id));assert.ok(projection().cursor<tail.seq);
 app.store.commitProactive('desktop-pet','later',{text:'主动的晚安。'},'fixture');assert.ok(!app.speech.visibleMessages(app.store.recent('desktop-pet')).some(r=>r.request_id==='speak-up:later'));
 players[1].emit('exit',0);await wait(()=>respond.length===1);respond.shift()();await wait(()=>players.length===3);players[2].emit('spawn');await app.speech.waitForText(tail.id);await wait(()=>projection().messages.some(r=>r.id===tail.id));
 players[2].emit('exit',0);await wait(()=>respond.length===1);respond.shift()();await wait(()=>players.length===4);players[3].emit('spawn');await app.speech.waitForText('desktop-pet:speak-up:later:assistant');await wait(()=>projection().messages.some(r=>r.request_id==='speak-up:later'));players[3].emit('exit',0);await wait(()=>app.speech.status().status==='idle');
 // Disabling during synthesis releases text and drops the delayed audio.
 returned=false;const cancelled=send('cancelled').then(r=>{returned=true;return r;});await wait(()=>respond.length===1);await api('PATCH','/v1/speech',{enabled:false});await cancelled;assert.equal(returned,true);respond.shift()();await wait(()=>app.speech.status().status==='idle');assert.equal(players.length,4);
 await api('PATCH','/v1/speech',{enabled:true});fail=true;await send('backend-failed');assert.equal(app.speech.status().status,'unavailable');fail=false;
 // A failed launch must not leave HTTP or projection waiting forever.
 playerFail=true;const badPlayer=send('player-failed');await wait(()=>respond.length===1);respond.shift()();await badPlayer;assert.equal(app.speech.status().status,'unavailable');playerFail=false;
 await api('PATCH','/v1/speech',{enabled:false});const count=requests;await send('disabled');assert.equal(requests,count);
 // Read-only history snapshots never cause archived lines to be re-spoken.
 await history();await events();assert.equal(requests,count);
 console.log('desktop-text-follow: HTTP/history/events/projection held until player spawn, before completion; ordered tail/proactive delivery; disable/failure text fallback; archive intact; no QQ sends passed');
}finally{if(app){for(const release of respond.splice(0))release();app.speech.stop();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));}fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
