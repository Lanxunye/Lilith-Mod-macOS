'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ConversationStore}=require('../src/conversation-store');
const {DEFAULTS,createQQCapabilities,limitedFetch}=require('../src/qq-capabilities');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-media-')),store=new ConversationStore(root);
 let cfg={...DEFAULTS,vision_enabled:true,vision_api_key:'private-test-key',stickers_enabled:true,search_enabled:true},image,isSticker=true,searchUrls=[];
 const cap=createQQCapabilities({root,store,getConfig:()=>cfg,requestJson:async(_url,body)=>{image=Buffer.from(body.messages[1].content[1].image_url.url.split(',')[1],'base64');return {choices:[{message:{content:JSON.stringify({description:'笑着喝茶的表情',is_sticker:isSticker})}}]};},fetchPublic:async(url,opts)=>{
   searchUrls.push(url);if(opts?.allowHost){assert.equal(opts.allowHost('qpic.cn'),true);assert.equal(opts.allowHost('evil.invalid'),false);return {bytes:image,type:'image/png',url};}
   if(url.startsWith('https://www.bing.com/'))return {bytes:Buffer.from('<item><title>ComfyUI</title><link>https://docs.comfy.org/</link></item>')};
   return {bytes:Buffer.from('<main>Public documentation</main>'),type:'text/html',url};
 }});
 let server;
 try{
  await cap.probeVision();cfg.vision_api_key='changed-test-key';assert.equal(cap.status().vision_status,'configured_unverified','changing credentials invalidates visual verification');
  const api=async action=>action==='get_msg'?{message_type:'group',group_id:444444,message:[{type:'image',data:{file:'opaque.png'}}]}:{url:'https://qpic.cn/public.png'};
  const info=await cap.describeMessage('1','group:444444','444444','111111',api);assert.equal(info.status,'recognized');assert.equal(info.items[0].is_sticker,true);const id=info.items[0].id;
  assert.equal(cap.stickerSegment(id,'group:555555'),null,'stickers never cross group boundaries');assert.match(cap.stickerSegment(id,'group:444444').data.file,/^base64:\/\//);
  assert.equal(cap.stickerSegment('../../private','group:444444'),null);
  cfg.media_roots=[root];const local=path.join(root,'cached.png');fs.writeFileSync(local,image);const denied=await cap.describeMessage('2','group:444444','444444','111111',async action=>action==='get_msg'?{message_type:'group',group_id:444444,message:[{type:'image',data:{file:'opaque.png'}}]}:{file:'/etc/hosts'});assert.equal(denied.status,'qq_image_path_denied');
  const evidence=await cap.search('ComfyUI 123456789 私密昵称',['私密昵称']);assert.equal(evidence.length,1);assert.doesNotMatch(searchUrls.at(-2),/123456789|%E7%A7%81/);assert.equal(evidence[0].excerpt,'Public documentation');
  const count=searchUrls.length;await cap.search('api_key private');assert.equal(searchUrls.length,count);
  cfg.stickers_enabled=false;assert.equal(cap.stickerSegment(id,'group:444444'),null);
  server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'audio/wav'});res.write(Buffer.alloc(800));res.end(Buffer.alloc(800));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await assert.rejects(()=>limitedFetch('http://127.0.0.1:'+server.address().port,{},1000),/too_large/);
  cfg.voice_enabled=true;cfg.voice_model='future-qwen';cfg.voice_url='http://127.0.0.1:'+server.address().port;
  const audio=await cap.voice('你好');assert.equal(audio.bytes.length,1600);assert.equal(audio.type,'audio/wav');assert.equal(cap.status().voice_status,'interface_only_not_qq_delivery');
  console.log('qq-media: scoped image retrieval/stickers, changed-key verification, file path denial, search query privacy/evidence, bounded streaming and voice-only interface passed (mock services).');
 }finally{await new Promise(r=>server?server.close(r):r());store.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
