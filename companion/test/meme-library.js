'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{createQQCapabilities,DEFAULTS}=require('../src/qq-capabilities'),{importLibrary}=require('../../scripts/import-meme-library.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-meme-library-')),store=new ConversationStore(root);
let config={...DEFAULTS,owner_qq:'111111',stickers_enabled:true,group_enabled:true,group_ids:['444444'],owner_stickers_enabled:false};
const cap=createQQCapabilities({root,store,getConfig:()=>config});
try{
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),id=crypto.createHash('sha256').update(gif).digest('hex'),source=path.join(root,'original.gif');fs.writeFileSync(source,gif);
 const prepared={assets:[{id,path:source,mime:'image/gif',animated:true,frames:2,bytes:gif.length,categories:[{key:'happy',description:'开心'}],sources:[{repo:'astrbot-deepseek-meme-pack',pack:'肥鱼',license:'CC0'}]}]},visual={[id]:{description:'可见人物开心地挥手',visible_text:'',use_for:'快乐庆祝'}};
 store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run('old','private:111111',source,'image/gif','原来保留的表情',new Date().toISOString());
 assert.equal(importLibrary(root,prepared,visual).added,1);assert.equal(importLibrary(root,prepared,visual).added,0,'idempotent content-addressed import');
 assert.ok(store.db.prepare('SELECT 1 FROM qq_stickers WHERE id=?').get('old'),'existing owner library is retained');
 assert.equal(cap.stickers('private:111111','哈哈开心')[0].id,id);assert.equal(cap.stickers('private:333333','开心').some(r=>r.id===id),false);
 assert.equal(cap.stickers('group:444444','开心').some(r=>r.id===id),false,'group access requires owner library permission');config.owner_stickers_enabled=true;
 assert.ok(cap.stickers('group:444444','开心').some(r=>r.id===id));assert.equal(cap.stickers('group:555555','开心').some(r=>r.id===id),false);
 const segment=cap.stickerSegment(id,'private:111111');assert.deepEqual(Buffer.from(segment.data.file.slice(9),'base64'),gif,'original GIF bytes reach the protocol unchanged');
 // Owner-reviewed meaning supersedes source folder labels and old vision text.
 const correctedId='5187f5ebaf67d6de0db593acd65dec6489f4791271186b8099d5df1b76ff1699';
 store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(correctedId,'library:public',source,'image/gif','开心、拥抱、一起睡觉',new Date().toISOString());
 store.db.prepare('INSERT INTO qq_meme_assets VALUES (?,?,1)').run(correctedId,JSON.stringify({...prepared.assets[0],id:correctedId}));
 assert.equal(cap.stickers('private:111111','抱紧我，一起睡觉').some(s=>s.id===correctedId),false);
 const corrected=cap.stickers('private:111111','恼羞成怒，欺负我一下').find(s=>s.id===correctedId);assert.match(corrected.description,/打闹/);assert.match(corrected.description,/不是拥抱/);
 assert.equal(cap.stickers('private:111111','哈哈开心').some(s=>s.id===correctedId),false,'generic happy folder cannot reintroduce wrong use');
 assert.match(cap.status().stickers.find(s=>s.id===correctedId).description,/恼羞成怒/);
 const library=require('../src/meme-library');assert.equal(library.correctedDescription('other','原释义'),'原释义');assert.equal(library.interpretationAllowed('constructor','晚安'),true);
 assert.equal(library.description({...prepared.assets[0],id:correctedId},visual[id]),corrected.description,'future reimport retains corrected meaning');
 config.group_stickers_enabled=false;assert.equal(cap.stickers('group:444444','开心').length,0);assert.equal(cap.stickerSegment(id,'group:444444'),null);assert.ok(cap.stickerSegment(id,'private:111111'),'private enablement cannot activate group stickers');
 store.db.prepare('UPDATE qq_meme_assets SET enabled=0 WHERE id=?').run(id);assert.equal(cap.stickerSegment(id,'private:111111'),null);assert.equal(cap.stickers('private:111111','开心').some(r=>r.id===id),false);
 importLibrary(root,prepared,visual);assert.equal(cap.stickerSegment(id,'private:111111'),null,'reimport does not undo manual disable');
 store.db.prepare('UPDATE qq_meme_assets SET enabled=1 WHERE id=?').run(id);fs.appendFileSync(path.join(root,'qq-media',id+'.gif'),'tamper');assert.equal(cap.stickerSegment(id,'private:111111'),null,'hash mismatch cannot be sent');
 // Special-topic source categories cannot flood unrelated ordinary chat.
 const {eligible}=require('../src/meme-library');assert.equal(eligible({categories:[{key:'_stock'}]},'今天吃什么'),false);assert.equal(eligible({categories:[{key:'_stock'}]},'今天股市如何'),true);
 console.log('meme-library: idempotent import, original GIF bytes, old library retention, owner/group boundaries, contextual retrieval, special topics, revoke and tamper rejection passed');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
