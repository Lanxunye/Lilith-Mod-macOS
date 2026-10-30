'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {ConversationStore}=require('../src/conversation-store'),{MusicLearning,intent}=require('../src/music-learning');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-music-test-')),store=new ConversationStore(root);
let clock=Date.parse('2026-10-28T12:00:00Z'),owner='111111',playing=true,models=0,rolls=0,release,waiting=false;
const song={id:'12345',title:'MUSIC_PRIVATE_CANARY',artists:['测试艺人'],album:'测试专辑',url:'https://music.163.com/#/song?id=12345'};
const source={snapshot:async()=>({running:true,available:true,playing,id:song.id,title:song.title,artist:'测试艺人',playback_status:playing?'playing':'paused'}),song:()=>song,playlist:()=>({id:'8781548197',name:'浔野的小歌单',tracks:[song],total:1,metadata_count:1,complete:true,artists:[{name:'测试艺人',count:1}],synced_at:clock}),publicRead:async op=>op==='lyrics'?{state:'read',text:'[00:01]一段测试歌词。'}:{songs:[song]},audio:()=>null};
const worker={complete:async()=>{models++;if(waiting)await new Promise(r=>release=r);return {summary:'读到了测试歌词。',thought:'这一句让我好奇。',stance:'curious',reason:'歌词把告别写成了等待。'};},async stop(){},async close(){}};
let app;const create=()=>new MusicLearning({home:path.join(root,'home'),store,source,worker,getEnvironment:()=>({owner,bot:'222222',session:'desktop-pet',available:true,warm:true,busy:false,quiet:false}),audio:async()=>({state:'unavailable',reason:'not_cached'}),now:()=>clock,random:()=>{rolls++;return 0;},autoTick:false});
(async()=>{try{
 app=create();app.patch({enabled:true,automatic:false});app.sync();assert.equal(app.profile().complete,true);
 assert.equal(app.context('qq_group','我在听什么？'),'');assert.equal(app.observe({channel:'qq_group',message:'分析这首歌'}),null);
 assert.throws(()=>app.enqueue({channel:'qq_group'}),/music_private_only/);assert.throws(()=>app.enqueue({channel:'qq',session:'another'}),/music_private_only/);
 assert.equal(intent('你还记得那首歌吗'),null);assert.equal(intent('推荐一首歌'),'recommend');
 await app.refresh();clock+=15000;await app.refresh();clock+=15000;await app.refresh();assert.equal(app.sample.stable,30);
 playing=false;clock+=15000;await app.refresh();assert.equal(app.sample,null);assert.equal(app.current().playing,false);playing=true;
 app.patch({automatic:true});for(let i=0;i<5;i++){clock+=15000;await app.tick();}
 assert.equal(models,1);assert.equal(rolls,1);assert.equal(app.records().jobs[0].state,'completed');assert.equal(app.interests().length,1);
 for(let i=0;i<5;i++){clock+=15000;await app.tick();}assert.equal(rolls,1,'a looping song gets one local die roll per day');
 assert.match(app.context('desktop','最近喜欢什么歌',null,'desktop-pet'),/MUSIC_PRIVATE_CANARY/);assert.match(app.context('qq','最近喜欢什么歌',null,'desktop-pet'),/MUSIC_PRIVATE_CANARY/);
 assert.equal(app.context('qq_group','最近喜欢什么歌'),'');assert.equal(app.context('desktop','最近喜欢什么歌',null,'unbound'),'');
 const counts=app.usage();await app.close();app=create();assert.deepEqual(app.usage(),counts);assert.equal(app.roll('track:12345'),false,'restart preserves dice decisions');
 const shared=app.opportunity();app.shared(shared.id,'qq:speak-up:fixture');assert.equal(app.opportunity(),null);assert.equal(app.shareAllowed({id:'qq:speak-up:fixture'}),true);
 owner='333333';assert.equal(app.current().available,false);assert.equal(app.records().jobs.length,0);assert.equal(app.interests().length,0);assert.equal(app.shareAllowed({id:'qq:speak-up:fixture'}),false);owner='111111';
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0,'background work never forges owner turns');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM facts').get().n,0,'own interests do not become owner facts');
 clock+=86400000;app.patch({automatic:false});await app.refresh();waiting=true;app.enqueue({kind:'current',request:'disable-test'});const pending=app.tick();while(!release)await new Promise(r=>setTimeout(r,1));app.patch({enabled:false});release();await pending;assert.equal(app.records().jobs[0].state,'cancelled');assert.equal(app.context('qq','最近喜欢什么歌'),'');assert.equal(app.shareAllowed({id:'qq:speak-up:fixture'}),false);
 console.log('music-learning: private/desktop scope, binding isolation, local dice once/day, sampled playback, independent interests, persisted budgets, no forged memory, shared cadence and in-flight disable passed');
}finally{await app?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
