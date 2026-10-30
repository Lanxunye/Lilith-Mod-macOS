'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {COMMANDS,parseCommand,commandHelp}=require('../src/qq-commands');
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge');
for(const c of COMMANDS)for(const name of c.names)for(const option of c.options){const input=['/lls',name,option].filter(Boolean).join(' ');assert.deepEqual(parseCommand(input),{action:c.action,option:option||undefined},input);assert.ok(commandHelp().includes(c.usage));}
assert.deepEqual(parseCommand('/LLS  GROUP \t TTS ON'),{action:'group tts',option:'on'});
for(const input of ['/lls unknown','/lls tts all on','/lls state off','/lls group all','/lls help on'])assert.equal(parseCommand(input).action,'invalid',input);
assert.equal(parseCommand('/llsabc'),null);assert.equal(parseCommand('普通聊天'),null);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-command-help-')),store=new ConversationStore(root);let bridge,clock=Date.now(),sent=[];
(async()=>{try{
 bridge=createQQBridge({root,store,autoTick:false,now:()=>new Date(clock),getPlayerName:()=>'',chat:async()=>{throw Error('help must never call model');},speechHealth:async()=>{throw Error('help must not probe synthesis');},request:async(url,options)=>{
  if(url.endsWith('/get_login_info'))return Response.json({status:'ok',retcode:0,data:{user_id:222222}});
  assert.ok(url.endsWith('/send_private_msg'));sent.push(JSON.parse(options.body));return Response.json({status:'ok',retcode:0,data:{message_id:sent.length}});
 }});
 bridge.configure({enabled:true,paused:true,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'secret',group_enabled:true,group_ids:['444444'],min_interval_ms:1000,max_per_minute:20});
 const before=fs.readFileSync(path.join(root,'qq.json'),'utf8');
 function event(id,text,user=111111,extra={}){const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:id,message:[{type:'text',data:{text}}],...extra});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','secret').update(raw).digest('hex'));}
 let id=0;for(const text of ['/lls','/lls help','/lls ?','/lls unknown','/lls state off']){
  assert.equal(event(++id,text).command,true);clock+=1100;await bridge.tick();assert.ok(sent.at(-1).message[0].data.text.endsWith(commandHelp()));
  assert.equal(fs.readFileSync(path.join(root,'qq.json'),'utf8'),before,'help and invalid commands cannot change flags or resume replies');
 }
 const count=sent.length;event(id,'/lls state off');clock+=1100;await bridge.tick();assert.equal(sent.length,count,'duplicate help event does not resend');
 assert.equal(event(++id,'/lls help',333333).accepted,false);assert.equal(bridge.status().paused,true);assert.equal(store.recent('desktop-pet').length,0);
 bridge.configure({paused:false});assert.equal(event(++id,'/lls help',111111,{message_type:'group',group_id:444444}).reason,'commands_owner_private_only');
 console.log('qq-command-help: every catalogue variant/alias, complete menu, invalid arguments, owner-only paused help, no model/history/config changes and dedup passed');
}finally{await bridge?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
