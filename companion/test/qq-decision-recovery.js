'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ConversationStore}=require('../src/conversation-store');
const {createQQCapabilities,DEFAULTS}=require('../src/qq-capabilities');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-decision-recovery-')),store=new ConversationStore(root);let raw='';
const cfg={...DEFAULTS,owner_qq:'111111',stickers_enabled:true,private_stickers_enabled:true,vision_enabled:true,vision_api_key:'fixture'};
const cap=createQQCapabilities({root,store,getConfig:()=>cfg,conversation:async()=>raw});
const input={scope:'group:444444',force:true,current:{text:'你好'},recent:[],stickers:[]};
(async()=>{try{
 let r=await cap.decide(input);assert.equal(r.action,'reply','an explicit mention retains its safe text fallback');assert.equal(cap.status().capability_error,'qq_decision_failed');
 raw='{"action":"skip","sticker_id":null}';r=await cap.decide({...input,force:false});assert.equal(r.action,'skip');assert.equal(cap.status().capability_error,'','a valid decision clears only its prior error');
 for(const invalid of ['[]','null','{"action":"execute"}','{"text":"not a decision"}']){raw=invalid;r=await cap.decide({...input,force:false});assert.equal(r.action,'skip');assert.equal(cap.status().capability_error,'qq_decision_failed','invalid JSON shapes must not claim recovery');}
 raw='{"action":"reply"}';await cap.decide(input);assert.equal(cap.status().capability_error,'');
 await cap.describeMessage('1','group:444444','444444','111111',async()=>({message_type:'private',user_id:111111}));assert.equal(cap.status().capability_error,'qq_image_outside_binding');
 await cap.decide(input);assert.equal(cap.status().capability_error,'qq_image_outside_binding','group recovery must not hide a vision error');
 raw='';await cap.decidePrivate({current:{text:'开心'},reply:'太好了',stickers:[{id:'fixture',description:'开心，认可'}]});assert.equal(cap.status().capability_error,'qq_private_sticker_decision_failed');
 raw='{"action":"reply"}';await cap.decide(input);assert.equal(cap.status().capability_error,'qq_private_sticker_decision_failed','group success must not clear a private selector error');
 raw='{"sticker_id":null}';await cap.decidePrivate({current:{text:'开心'},reply:'太好了',stickers:[{id:'fixture',description:'开心，认可'}]});assert.equal(cap.status().capability_error,'');
 console.log('qq-decision-recovery: reasoning-only/invalid output fallbacks, strict decision shape, recovery clearing and unrelated vision/private error preservation passed');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
