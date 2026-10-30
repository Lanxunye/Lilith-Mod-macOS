'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ConversationStore}=require('../src/conversation-store'),{DEFAULTS,createQQCapabilities,searchRelevant}=require('../src/qq-capabilities');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-mainline-')),store=new ConversationStore(root);
try{
 assert.equal(searchRelevant('ComfyUI documentation',{title:'Love hotel',url:'https://example.com/hotel',snippet:'酒店信息'}),false);assert.equal(searchRelevant('ComfyUI documentation',{title:'ComfyUI Docs',url:'https://docs.comfy.org'}),true);
 const c={...DEFAULTS,owner_qq:'111111',group_enabled:true,group_ids:['444444'],stickers_enabled:true};
 const cap=createQQCapabilities({root,store,getConfig:()=>c});let target;
 const tiny=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
 for(let n=0;n<30;n++){const bytes=Buffer.concat([tiny,Buffer.from(String(n))]),id=crypto.createHash('sha256').update(bytes).digest('hex'),file=path.join(root,'qq-media',id+'.png');fs.writeFileSync(file,bytes);store.db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?)').run(id,'private:111111',file,'image/png',n===0?'晚安，该休息了':'开心，赞同，微笑',new Date(Date.UTC(2026,0,1,0,n)).toISOString());if(n===0)target=id;}
 assert.equal(cap.stickers('group:444444').length,0,'owner library is disabled by default');assert.equal(cap.stickerSegment(target,'group:444444'),null);
 c.owner_stickers_enabled=true;const list=cap.stickers('group:444444','今天该说晚安');assert.equal(list.length,20);assert.equal(list[0].id,target,'context can retrieve an older relevant expression outside the latest twenty');assert.equal(list[0].source,'owner_library');assert.match(cap.stickerSegment(target,'group:444444').data.file,/^base64:\/\//);
 assert.equal(cap.stickers('group:555555').length,0);assert.equal(cap.stickerSegment(target,'group:555555'),null,'owner permission covers only configured groups');assert.equal(cap.stickerSegment('../../outside','group:444444'),null);
 c.owner_stickers_enabled=false;assert.equal(cap.stickerSegment(target,'group:444444'),null);
 const session='qq-group:222222:444444',insert=store.db.prepare('INSERT INTO facts VALUES (?,?,?,?,?,?)');
 insert.run(store.ownerId+':'+session,'333333:饮食','不喝咖啡','source-a','不喝咖啡','2026-01-01');
 for(let n=0;n<60;n++)insert.run(store.ownerId+':'+session,'555555:事实'+n,'新成员信息','source-b','新成员信息','2026-02-'+String(n).padStart(2,'0'));
 insert.run(store.ownerId+':qq-group:222222:999999','333333:私密','OTHER_GROUP_CANARY','source-c','证据','2026-03-01');
 assert.equal(store.facts(session).some(f=>f.key==='333333:饮食'),false,'fixture is outside the generic recent-memory window');const facts=store.groupMemberFacts(session,['333333']);assert.equal(facts.length,1);assert.equal(facts[0].value,'不喝咖啡');assert.doesNotMatch(JSON.stringify(facts),/OTHER_GROUP_CANARY|新成员信息/);assert.equal(store.groupMemberFacts('desktop-pet',['333333']).length,0);
 console.log('qq-mainline: explicit owner-library permission, whitelist scope, contextual older-sticker retrieval, revocation and stable per-member memory outside the recent window passed.');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
