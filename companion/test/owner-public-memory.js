'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {ConversationStore}=require('../src/conversation-store'),{createOwnerPublicMemory,candidate}=require('../src/owner-public-memory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-public-memory-')),store=new ConversationStore(root);let enabled=true;
const q={bot_qq:'222222',owner_qq:'111111',session_id:'desktop-pet',group_ids:['444444','555555']};
let native={memories:[{category:'event',text:'SECRET_PRIVATE_EVENT_CANARY',source:{quote:'SECRET_PRIVATE_EVENT_CANARY'}}]};
const shared=createOwnerPublicMemory({store,getQQ:()=>q,isEnabled:()=>enabled,getMemory:()=>({load:()=>native})});
function commit(session,request,text,channel){store.begin(session,request,{message:text,channel});store.commit(session,request,text,{text:'好呀。'},channel,'fixture');}
const update=(value,key='music_preference')=>({key,value,evidence:'我喜欢'+value});
try{
 commit('desktop-pet','p1','我喜欢爵士乐。今天经历的PRIVATE_EXPERIENCE不要带出去。','qq');
 assert.equal(shared.capture({channel:'qq',session:'desktop-pet',request:'p1',updates:[update('爵士乐')]}).stored,1);
 let text=shared.prompt('qq_group','qq-group:222222:444444',{_qq_speaker:'111111'});assert.match(text,/爵士乐/);assert.doesNotMatch(text,/PRIVATE_EXPERIENCE|SECRET_PRIVATE_EVENT/);
 assert.equal(shared.prompt('qq_group','qq-group:222222:444444',{_qq_speaker:'333333',player:{name:'主人'}}),'');
 assert.equal(shared.prompt('qq_group','qq-group:222222:999999',{_qq_speaker:'111111'}),'');
 const group='qq-group:222222:444444',message='群聊消息：\n'+JSON.stringify({speaker:{qq:'111111'},text:'我喜欢轻音乐。',quote:{speaker:{qq:'333333'},text:'我喜欢摇滚乐。'}});
 commit(group,'g1',message,'qq_group');assert.equal(shared.capture({channel:'qq_group',session:group,request:'g1',body:{_qq_speaker:'111111'},updates:[update('轻音乐')]}).stored,1);
 text=shared.prompt('qq','desktop-pet');assert.match(text,/轻音乐/);assert.match(text,/爵士乐/,'a new preference does not erase another one');assert.match(shared.prompt('qq_group','qq-group:222222:555555',{_qq_speaker:'111111'}),/轻音乐/);
 assert.equal(shared.capture({channel:'qq_group',session:group,request:'g1',body:{_qq_speaker:'111111'},updates:[update('摇滚乐')]}).stored,0);
 commit(group,'g2','群聊消息：\n'+JSON.stringify({speaker:{qq:'333333'},text:'我喜欢摇滚乐。'}),'qq_group');assert.equal(shared.capture({channel:'qq_group',session:group,request:'g2',body:{_qq_speaker:'111111'},updates:[update('摇滚乐')]}).stored,0,'stored source identity overrides forged metadata');
 for(const raw of ['他说我喜欢爵士乐。','“我喜欢爵士乐。”','我喜欢爵士乐，但不要告诉其他人。'])assert.equal(candidate(update('爵士乐'),raw),null);
 assert.ok(candidate({key:'music_preference',value:'爵士乐',evidence:'我喜欢爵士乐。'},'我喜欢爵士乐。'),'real native output may include terminal punctuation');
 assert.equal(candidate({key:'nickname',value:'小月',evidence:'叫我小月'},'叫我小月。').value,'小月');
 assert.equal(candidate({key:'address',value:'某处',evidence:'我住在某处'},'我住在某处'),null);
 assert.equal(candidate(update('病情记录'), '我喜欢病情记录。'),null);assert.equal(candidate({...update('爵士乐'),value:'编造信息'},'我喜欢爵士乐。'),null);
 enabled=false;assert.equal(shared.prompt('qq','desktop-pet'),'');assert.equal(shared.capture({channel:'qq',session:'desktop-pet',request:'p1',updates:[]}).stored,0);enabled=true;
 q.owner_qq='777777';assert.equal(shared.status().count,0,'rebinding never transfers previous owner facts');q.owner_qq='111111';
 shared.clear();assert.equal(shared.status().count,0);assert.doesNotMatch(shared.prompt('qq','desktop-pet'),/轻音乐/,'forget does not resurrect old imports');
 console.log('owner-public-memory: verified identity/source, bidirectional current facts, third-party/quote/secret exclusion, private-event isolation, opt-off, rebind and forget passed');
}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
