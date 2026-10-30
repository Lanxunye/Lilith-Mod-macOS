'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ConversationStore}=require('../src/conversation-store'),{MemoryStore}=require('../src/dsh-memory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-memory-migration-'));
let archive;
try{
 archive=new ConversationStore(root);
 for(const [session,channel,message]of [['desktop-pet','desktop','我最喜欢柠檬红茶'],['qq-group:444444','qq_group','我最喜欢薄荷茶']]){
  archive.begin(session,'one',{message});archive.commit(session,'one',message,{text:'我猜用户住在月球。'},channel,'fixture',null,
   {updates:[{key:'drink',value:message,evidence:message}],sensitive:()=>false});
  const rows=archive.recent(session);archive.saveSummary(session,rows,rows.map(r=>({source_id:r.id,quote:r.content})));
 }
 const candidates=archive.memoryCandidates();assert.ok(candidates.length>=1);assert.ok(candidates.every(x=>!x.quote.includes('薄荷')&&!x.quote.includes('月球')));
 const index=new MemoryStore(path.join(root,'dsh'));assert.ok(index.importLegacy(candidates).imported>0);
 assert.ok(index.load().memories.every(m=>m.source.kind==='legacy_archive'));
 index.forgetAll();archive.clearDerived();assert.equal(archive.memoryCandidates().length,0);assert.equal(index.importLegacy(candidates).imported,0);
 assert.deepEqual(fs.readFileSync(path.resolve(__dirname,'../src/dsh-memory.js')),fs.readFileSync(path.resolve(__dirname,'../../dsh-fish-memory-lilith/store.cjs')));
 console.log('dsh-memory: existing archive provenance, owner/group isolation, assistant-guess exclusion, non-resurrecting forget and shared package passed');
}finally{archive?.close();fs.rmSync(root,{recursive:true,force:true});}
