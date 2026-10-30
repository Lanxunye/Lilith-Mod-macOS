import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {calculate} from './index.mjs';
import controller from '../companion/src/dsh-speak-up.js';
const {SpeakUp,DEFAULTS}=controller;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-speak-test-'));
const base=Date.parse('2026-10-26T02:00:00Z'); // Monday 10:00 Beijing
test('pinned upstream probabilities, Beijing peak and quiet boundaries',()=>{
 const c={...DEFAULTS};
 assert.equal(calculate(c,0,base-3600000,base).threshold,20);
 assert.equal(calculate(c,2,base-3600000,base).threshold,40);
 assert.equal(calculate(c,20,base-3600000,base).threshold,60);
 assert.equal(calculate(c,0,base-60000,base).threshold,3);
 assert.equal(calculate(c,0,base-7*3600000,base).threshold,30);
 assert.equal(calculate(c,0,base-3600000,Date.parse('2026-10-25T02:00:00Z')).base,60);
 for(const [h,q]of [[0,false],[1,true],[7,true],[8,false]]){
  assert.equal(calculate(c,0,base,Date.parse(`2026-10-26T${String(h).padStart(2,'0')}:00:00+08:00`)).quiet,q);
 }
});
test('gates, misses, dry hit and preview cost zero model calls',async()=>{
 let at=base,calls=0,draws=0,roll=.99;
 const env={loaded:true,warm:{key:'desktop:desktop-pet'},busy:false,pending_owner:0,qq_available:true,last_owner_seq:1,owner_signal:1,last_activity_at:base-3600000};
 const app=new SpeakUp({home:path.join(root,'gates'),now:()=>at,random:()=>{draws++;return roll;},autoTick:false,loadEngine:async()=>({calculate}),getEnvironment:()=>({...env}),deliver:async()=>{calls++;return {committed:true};}});
 const tick=async()=>{at+=31*60000;return app.tick();};
 await app.ready;
 const snapshot=JSON.stringify(app.state);assert.equal((await app.preview()).model_calls,0);assert.equal(JSON.stringify(app.state),snapshot);assert.equal(draws,0);
 env.warm=null;assert.equal((await tick()).result,'no_live_conversation');assert.equal(draws,0);
 env.warm={};env.busy=true;assert.equal((await tick()).result,'conversation_busy');env.busy=false;
 env.qq_available=false;assert.equal((await tick()).result,'qq_unavailable');env.qq_available=true;
 assert.equal((await tick()).result,'miss');assert.equal(app.state.misses,1);
 roll=0;assert.equal((await tick()).result,'dry_hit');assert.equal(calls,0);
 app.patch({enabled:false});assert.equal((await tick()).result,'not_due');assert.equal(calls,0);
 await app.close();
});
test('durable unanswered/cooldown/budget, owner races and interrupted restart',async()=>{
 let at=base,calls=0,race=false;
 const home=path.join(root,'durable'),env={loaded:true,warm:{},busy:false,qq_available:true,last_owner_seq:1,owner_signal:1,last_activity_at:base-3600000};
 const options={home,now:()=>at,random:()=>0,autoTick:false,loadEngine:async()=>({calculate}),getEnvironment:()=>({...env}),deliver:async({stillValid})=>{calls++;if(race)env.owner_signal++;return {committed:stillValid()};}};
 let app=new SpeakUp(options);await app.ready;app.patch({dry_run:false,quiet_start:0,quiet_end:0,interval_minutes:1});
 at+=60000;assert.equal((await app.tick()).committed,true);assert.equal(calls,1);
 at+=60000;assert.equal((await app.tick()).result,'cooldown');
 await app.close();app=new SpeakUp(options);await app.ready;
 at+=21*60000;assert.equal((await app.tick()).result,'awaiting_owner');assert.equal(calls,1);
 env.last_owner_seq=2;env.owner_signal++;race=true;at+=60000;
 assert.equal((await app.tick()).committed,false);assert.equal(app.state.attempts,2);
 assert.equal(app.state.awaiting_owner_seq,1);race=false;
 app.state.inflight='interrupted-fixture';app.save();await app.close();
 app=new SpeakUp(options);await app.ready;assert.equal(app.state.inflight,undefined);assert.equal(app.state.logs.at(-1).result,'interrupted');
 app.patch({daily_limit:2});at+=21*60000;assert.equal((await app.tick()).result,'daily_limit');assert.equal(calls,2);
 await app.close();
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
