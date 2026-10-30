'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DshCost,boundedPrompt}=require('../src/dsh-cost');
const {DshConversation}=require('../src/dsh-conversation');
const {prepareDshProfile}=require('../src/dsh-profile');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-cost-'));let dsh;
(async()=>{try{
 let now=Date.UTC(2026,9,30,1);const cost=new DshCost(path.join(root,'meter'),{now:()=>now});
 cost.record('group_decision',{inputTokens:10,cacheReadTokens:20,outputTokens:3,totalTokens:33});assert.equal(cost.status().by_module.group_decision.totalTokens,33);
 cost.fail('QUOTA');assert.throws(()=>cost.check(),{code:'dsh_quota_exceeded'});now+=300001;cost.check();
 cost.fail('AUTH');cost.reset();cost.check();assert.doesNotMatch(fs.readFileSync(cost.file,'utf8'),/content|prompt|message/);
 const data=JSON.parse(boundedPrompt(JSON.stringify({recent_visible_conversation:Array.from({length:24},(_,i)=>({role:'user',content:i+':'+'.'.repeat(2000)})),current_user_message:'preserved'})));
 assert.ok(JSON.stringify(data.recent_visible_conversation).length<16100);assert.equal(data.current_user_message,'preserved');assert.ok(data.recent_visible_conversation.at(-1).content.startsWith('23:'));
 const sourceHome=path.join(root,'native'),desktop=path.join(sourceHome,'profiles/desktop');fs.mkdirSync(desktop,{recursive:true});
 fs.writeFileSync(path.join(desktop,'cordis.patch.yml'),'- insert:\n    - id: rea-fixture\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: rea\n        command: node\n        args: ["/fixture/rea/rea.mjs"]\n');
 const seen=[];
 dsh=new DshConversation({root:path.join(root,'service'),workspace:path.join(root,'workspace'),getConfig:()=>({integrations:{dsh:{executable:process.execPath}}}),getPersona:()=> '莉莉丝固定人格',getEndpoint:()=> 'http://127.0.0.1:1',prepareProfile:o=>prepareDshProfile({...o,sourceHome,osHome:root}),runtimeFactory:o=>{
  seen.push(o);return {ready:Promise.resolve(),exited:false,async run(id,prompt,resume){this.calls??=[];this.calls.push({id,prompt,resume});o.onEvent('session.event',{sessionId:id,event:{type:'assistant/message',data:{content:'{"text":"正常"}',usage:{inputTokens:100,cacheReadTokens:200,outputTokens:20,totalTokens:320}}}});o.onEvent('session.event',{sessionId:id,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});},async close(){this.exited=true;},async stop(){this.exited=true;}};
 }});
 const input={key:'qq:desktop-pet',conversation:'desktop-pet',channel:'qq',tools:true,system:'完整人格规则',prompt:JSON.stringify({recent_visible_conversation:[],current_user_message:'你好'})};
 await dsh.complete(input);await dsh.complete(input);const main=seen[0];assert.equal(dsh.status().tools_disabled,true);assert.equal(main.nativeProfile.status.chat_only,true);assert.match(fs.readFileSync(main.nativeProfile.patchFile,'utf8'),/- id: tool-bash\n  disabled: true/);assert.match(main.nativeProfile.patchFile,/lilith.patch.yml/);assert.match(dsh.runtime.calls[0].prompt,/本轮工具权限：禁止任何工具调用/);assert.notEqual(dsh.runtime.calls[0].id,dsh.runtime.calls[1].id);assert.equal(dsh.runtime.calls[1].resume,false);
 assert.equal(dsh.status().rea_disabled,true);assert.equal(dsh.status().mcp_count,0);assert.doesNotMatch(fs.readFileSync(path.join(main.home,'profiles/lilith/cordis.patch.yml'),'utf8'),/rea-fixture/);
 // An existing seeded REA client is disabled by the final overlay, not merely
 // hidden from execution. Native/ordinary desktop configuration is untouched.
 const noTools=require('../src/dsh-aux-guard.mjs');const decisions=[];let ready;noTools.apply({tools:{guard:f=>decisions.push(f)},provide:(name,value)=>{ready=value;}});assert.equal(decisions[0]({name:'bash'}),'LILITH_TOOLS_FORBIDDEN_IN_THIS_CONTEXT');assert.equal(ready.tools,false);
 const local=path.join(main.home,'profiles/lilith/cordis.patch.yml');fs.appendFileSync(local,fs.readFileSync(path.join(desktop,'cordis.patch.yml')));
 const prepared=prepareDshProfile({home:main.home,workspace:main.workspace,sourceHome,guardPlugin:path.resolve(__dirname,'../src/dsh-guard.mjs'),guardEndpoint:'http://127.0.0.1:1/v1/dsh/guard',guardToken:'fixture-token-123456789'});
 assert.match(fs.readFileSync(prepared.patchFile,'utf8'),/- id: rea-fixture\n  disabled: true/);
 await dsh.complete({key:'qq-decision',conversation:'internal',channel:'aux',tools:false,ephemeral:true,maxTokens:256,system:'你为莉莉丝与绑定主人的私聊选择表情',prompt:'{}'});
 const aux=seen[1];assert.equal(aux.maxTokens,256);assert.equal(aux.nativeProfile.reasoningEffort,'off');assert.equal(aux.nativeProfile.status.auxiliary_profile,true);assert.match(fs.readFileSync(aux.nativeProfile.patchFile,'utf8'),/- id: tool-bash\n  disabled: true/);assert.match(aux.nativeProfile.patchFile,/auxiliary-256/);
 await dsh.complete({key:'search-plan',conversation:'search',channel:'aux',tools:false,ephemeral:true,maxTokens:256,system:'只返回JSON',prompt:'{}'});assert.equal(seen[2].nativeProfile.reasoningEffort,'low','non-decision tasks retain their reasoning policy');assert.notEqual(seen[2].home,aux.home,'equal output budgets must not reuse a runtime with a different reasoning policy');
 assert.equal(dsh.status().cost_control.by_module.private_chat.calls,2);assert.equal(dsh.status().cost_control.by_module.sticker_selector.calls,1);
 console.log('dsh-cost: loader-level REA disable, native profile preservation, bounded chat snapshots, isolated auxiliary budgets, usage accounting and quota/auth circuit passed');
}finally{await dsh?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
