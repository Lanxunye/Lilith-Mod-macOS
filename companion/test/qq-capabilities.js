'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ConversationStore}=require('../src/conversation-store');
const {DEFAULTS,patchCapabilities,createQQCapabilities,imageType}=require('../src/qq-capabilities');
const {publicAddress}=require('../src/qq-public-web');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-qq-cap-'));const store=new ConversationStore(root);let cfg={...DEFAULTS};let requests=[];
 const cap=createQQCapabilities({root,store,getConfig:()=>cfg,getProvider:()=>({}),requestJson:async(url,body,headers)=>{requests.push({url,body,headers});return {choices:[{message:{content:JSON.stringify({description:'左红右蓝的色块',is_sticker:false})}}]};}});
 try{
  assert.equal(cap.status().vision_status,'disabled');
  patchCapabilities(cfg,{vision_enabled:true,vision_api_key:'private-vision-fixture',vision_base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',vision_model:'qwen3-vl-plus'});
  assert.equal(cap.status().vision_status,'configured_unverified');assert.equal(cap.status().vision_api_key_configured,true);assert.doesNotMatch(JSON.stringify(cap.status()),/private-vision-fixture/);
  await cap.probeVision();assert.equal(requests.length,1);const request=requests[0];assert.equal(request.url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer private-vision-fixture');assert.equal(request.body.model,'qwen3-vl-plus');
  const image=request.body.messages[1].content.find(c=>c.type==='image_url').image_url.url;assert.match(image,/^data:image\/png;base64,/);const bytes=Buffer.from(image.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),32);assert.equal(imageType(bytes),'image/png');assert.equal(cap.status().vision_status,'verified_this_run');
  const before=requests.length;const cross=await cap.describeMessage('1','group:444444','444444','111111',async()=>({message_type:'private',user_id:111111}));assert.equal(cross.status,'qq_image_outside_binding');assert.equal(requests.length,before);
  assert.throws(()=>patchCapabilities(cfg,{voice_url:'https://example.com/v1/audio/speech'}),/invalid_qq_endpoint/);
  assert.throws(()=>patchCapabilities(cfg,{random_wake_probability:.9}),/invalid_random/);assert.throws(()=>patchCapabilities(cfg,{media_roots:['relative']}),/invalid_media/);
  assert.equal(publicAddress('127.0.0.1'),false);assert.equal(publicAddress('169.254.169.254'),false);assert.equal(publicAddress('10.0.0.1'),false);assert.equal(publicAddress('::1'),false);assert.equal(publicAddress('::ffff:127.0.0.1'),false);assert.equal(publicAddress('8.8.8.8'),true);
  await assert.rejects(()=>cap.voice('hello'),/qq_voice_interface_not_configured/);
  cfg={...cfg,vision_enabled:false};assert.equal((await cap.describeMessage('2','group:444444','444444','111111',()=>{throw Error('must not read');})).status,'not_configured');
  console.log('qq-capabilities: visual endpoint/credentials redacted, actual 32px image payload, status, cross-chat denial, configuration validation, private network denial and inactive voice interface passed (mock visual provider).');
 }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
