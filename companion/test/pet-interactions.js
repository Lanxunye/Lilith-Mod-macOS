'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PetInteractions}=require('../src/pet-interactions'),{readPet,effectiveMood,context}=require('../src/pet-affection-view.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-pet-test-'));let at=new Date(2026,9,26,23,59,10).getTime();let pet;
const event=(kind='head_pat',time=at,id=crypto.randomUUID())=>({id,kind,at:time});
try{
 pet=new PetInteractions({root,now:()=>at,autoTick:false});let e=event();
 assert.equal(pet.accept({events:[e]}).results[0].credited,true);assert.equal(pet.status().daily_mood_bonus,2);assert.equal(pet.status().dependency,.2);
 assert.equal(pet.accept({events:[e]}).results[0].reason,'duplicate');
 assert.equal(pet.accept({events:[event('head_rub')]}).results[0].reason,'cooldown','one head gesture is not double rewarded through another native hook');
 pet.close();pet=new PetInteractions({root,now:()=>at,autoTick:false});assert.equal(pet.status().dependency,.2);assert.equal(pet.accept({events:[e]}).results[0].reason,'duplicate');
 at=new Date(2026,9,27,0,0,0).getTime();const s=pet.status();assert.equal(s.daily_mood_bonus,0);assert.equal(s.dependency,.2);assert.equal(s.daily_count,0);assert.equal(s.dependency_today,0);
 assert.equal(pet.accept({events:[event('hand_touch',at-1000)]}).results[0].reason,'previous_day');
 for(let i=0;i<40;i++){pet.accept({events:[event('hand_touch')]});at+=31000;}
 assert.equal(pet.status().daily_mood_bonus,20);assert.equal(pet.status().dependency_today,2);assert.equal(pet.status().dependency,2.2);
 assert.equal(effectiveMood(95,pet.status()),100);
 const before=fs.readFileSync(pet.file,'utf8');assert.throws(()=>pet.accept({events:[event(),event('drag')]}),/invalid_pet_event/);assert.equal(fs.readFileSync(pet.file,'utf8'),before,'validate entire batch before applying any event');
 assert.equal(pet.accept({events:[event('head_pat',at-300001)]}).results[0].reason,'stale');
 at=new Date(2026,9,28,0,0,0).getTime();const projection=readPet(pet.file,at);assert.equal(projection.daily_mood_bonus,0,'mood SDK cannot see yesterday bonus even before host timer catches up');assert.equal(projection.dependency,2.2);
 assert.match(context(projection,70),/额外心情\+0/);assert.match(context(projection,70),/依赖度2.2/);
 assert.equal(fs.statSync(pet.file).mode&0o777,0o600);
 const badRoot=path.join(root,'bad');fs.mkdirSync(path.join(badRoot,'pet-interactions'),{recursive:true});const badFile=path.join(badRoot,'pet-interactions/state.json');fs.writeFileSync(badFile,'invalid-json');const bad=new PetInteractions({root:badRoot,now:()=>at,autoTick:false});assert.equal(bad.status().error,'pet_state_invalid');assert.throws(()=>bad.accept({events:[event()]}),/pet_state_unavailable/);assert.equal(fs.readFileSync(badFile,'utf8'),'invalid-json');bad.close();
 assert.equal(fs.readFileSync(path.resolve(__dirname,'../../dsh-feiyu-mood-lilith/pet-affection-view.cjs'),'utf8'),fs.readFileSync(path.resolve(__dirname,'../src/pet-affection-view.cjs'),'utf8'));
 console.log('pet-interactions: native event whitelist, gesture coalescing, persistent dedup, daily/lifetime caps, local midnight/lazy reset, persistent dependency and split mood overlay passed.');
}finally{pet?.close();fs.rmSync(root,{recursive:true,force:true});}

(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-pet-http-'));process.env.LILITH_AI_DATA_DIR=data;
 fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({mock_mode:true,media:{enabled:false}}));
 const {createApp}=require('../src/server');const clock=Date.now(),app=createApp({chatEngine:'provider-test',petOptions:{now:()=>clock,autoTick:false},qqOptions:{autoTick:false}});
 try{
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const denied=await fetch(base+'/v1/pet/interactions');assert.equal(denied.status,401);
  const headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
  let r=await fetch(base+'/v1/pet/interactions',{method:'POST',headers,body:JSON.stringify({events:[{id:crypto.randomUUID(),kind:'head_pat',at:clock}]})});assert.equal(r.status,200);assert.equal((await r.json()).state.daily_mood_bonus,2);
  r=await fetch(base+'/v1/pet/interactions',{method:'POST',headers,body:JSON.stringify({events:[{id:crypto.randomUUID(),kind:'drag',at:clock}]})});assert.equal(r.status,400);
  r=await fetch(base+'/v1/session/desktop-pet/message',{method:'POST',headers,body:JSON.stringify({request_id:'typed-pet',message:'我在文字里说我摸头了'})});assert.equal(r.status,200);
  r=await fetch(base+'/v1/pet/interactions',{headers});assert.equal((await r.json()).daily_count,1,'typed chat is not a native interaction');
  console.log('pet-interactions HTTP: authenticated intake/status, unsupported actions rejected and typed chat cannot award native interaction points passed.');
 }finally{await app.qq.close();await app.tasks.close();await app.mediaMonitor.stop();await new Promise(r=>app.server.close(r));fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
