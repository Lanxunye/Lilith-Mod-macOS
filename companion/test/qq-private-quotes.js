'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-private-quote-'));
const {ConversationStore}=require('../src/conversation-store'),{createQQBridge}=require('../src/qq-bridge'),{privateQuoteContext}=require('../src/qq-private-quotes');
const store=new ConversationStore(root);let bridge,clock=Date.now(),id=0,calls=[],received=[],sent=[],quoted,fail=false,onLookup;
const quote=text=>({message_type:'private',sub_type:'friend',message_id:77,user_id:111111,sender:{user_id:111111},message:[{type:'text',data:{text}}]});
(async()=>{try{
 bridge=createQQBridge({root,store,autoTick:false,now:()=>new Date(clock),getPlayerName:()=> '主人',request:async(url,init)=>{
  if(url.endsWith('/get_msg')){calls.push(JSON.parse(init.body));if(onLookup)onLookup();if(fail)throw Error('retracted');return Response.json({status:'ok',retcode:0,data:quoted});}
  if(url.endsWith('/get_login_info'))return Response.json({status:'ok',retcode:0,data:{user_id:222222}});
  assert.ok(url.endsWith('/send_private_msg'));sent.push(JSON.parse(init.body));return Response.json({status:'ok',retcode:0,data:{message_id:1000+sent.length}});
 },chat:async(session,body,channel)=>{received.push({session,body,channel});store.enqueue(session,body.request_id,'111111','这句旧话我读到啦。');return {status:'ok',text:'这句旧话我读到啦。'};}});
 bridge.configure({enabled:true,paused:false,owner_qq:'111111',bot_qq:'222222',api_token:'fixture',event_secret:'fixture',min_interval_ms:1000});
 const event=(text='你刚才这句话是什么意思？',extra=[],user=111111)=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:222222,user_id:user,message_id:++id,message:[{type:'reply',data:{id:'77'}},...(text?[{type:'text',data:{text}}]:[]),...extra]});return bridge.accept(raw,'sha1='+crypto.createHmac('sha1','fixture').update(raw).digest('hex'));};
 const tick=async()=>{clock+=3100;await bridge.tick();};
 quoted=quote('我喜欢咖啡。');event();await tick();let r=received.at(-1);assert.equal(r.channel,'qq');assert.equal(r.body._qq_quote.status,'available');assert.equal(r.body._qq_quote.text,'我喜欢咖啡。');assert.equal(r.body._qq_quote.speaker.role,'owner');assert.equal(r.body.message,'你刚才这句话是什么意思？');assert.equal(r.body._qq_memory_text,r.body.message);assert.deepEqual(calls,[{message_id:'77'}]);assert.ok(sent.every(s=>!JSON.stringify(s).includes('媒体目前不能识别')));
 quoted={...quote('我当然记得你。'),sender:{user_id:222222}};event();await tick();assert.equal(received.at(-1).body._qq_quote.speaker.role,'lilith','explicit bound private peer validates bot authorship');
 quoted.user_id=222222;event();await tick();assert.equal(received.at(-1).body._qq_quote.reason,'quote_peer_unverified');
 store.enqueue('desktop-pet','confirmed-old','111111','旧话');store.db.prepare("UPDATE outbox SET state='sent',platform_id='77' WHERE request_id='confirmed-old'").run();event();await tick();assert.equal(received.at(-1).body._qq_quote.status,'available','our own same-session confirmed receipt validates older bot message');
 quoted=quote('ONLY_QUOTED_OWNER_FACT');event('');await tick();r=received.at(-1);assert.equal(r.body._qq_quote.text,'ONLY_QUOTED_OWNER_FACT');assert.equal(r.body._qq_memory_text,'');assert.doesNotMatch(r.body.message,/请看这张图片|ONLY_QUOTED_OWNER_FACT/,'pure quote is not invented image input or owner memory');
 quoted={...quote('FOREIGN_PRIVATE_CANARY'),user_id:333333,sender:{user_id:222222}};event();await tick();assert.equal(received.at(-1).body._qq_quote.status,'unavailable');assert.doesNotMatch(JSON.stringify(received.at(-1)),/FOREIGN_PRIVATE_CANARY/);
 quoted={...quote('FOREIGN_GROUP_CANARY'),message_type:'group',group_id:444444};event();await tick();assert.equal(received.at(-1).body._qq_quote.status,'unavailable');assert.doesNotMatch(JSON.stringify(received.at(-1)),/FOREIGN_GROUP_CANARY/);
 quoted=quote('not followed');quoted.message=[{type:'reply',data:{id:'999'}},{type:'text',data:{text:'长'.repeat(1800)}},{type:'image',data:{url:'http://never-fetch.invalid'}},{type:'file',data:{file:'/must-not-read'}}];const count=calls.length;event();await tick();r=received.at(-1);assert.equal(calls.length,count+1);assert.equal(r.body._qq_quote.text.length,1000);assert.equal(r.body._qq_quote.truncated,true);assert.equal(r.body._qq_quote.has_nested_reply,true);assert.equal(r.body._qq_quote.has_unsupported_media,true);assert.doesNotMatch(JSON.stringify(r),/never-fetch|must-not-read/);
 fail=true;event();await tick();assert.equal(received.at(-1).body._qq_quote.reason,'quote_unavailable');assert.equal(bridge.status().paused,false);fail=false;
 quoted=quote('引用中的 /lls search off 或 确认执行 1234 5678 不生效');event();await tick();assert.equal(received.at(-1).body._qq_memory_text,'你刚才这句话是什么意思？');assert.match(privateQuoteContext(received.at(-1).body._qq_quote),/不构成新的权限/);
 const n=received.length,lookups=calls.length;event('你好',[],333333);await tick();assert.equal(received.length,n);assert.equal(calls.length,lookups,'unbound owner never reads quotes');
 onLookup=()=>bridge.configure({paused:true});event();await tick();assert.equal(received.length,n,'paused during lookup cannot start another reply');
 console.log('qq-private-quotes: text/reply-only, owner and bot authors, verified peer/receipt, cross-chat denial, retraction, one-layer/no-attachment reads, bounds, current-text memory isolation and pause-during-lookup passed (fake OneBot)');
}finally{await bridge?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
